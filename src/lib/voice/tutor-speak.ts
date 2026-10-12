import { postTts, type TtsRequest } from '@/lib/api'
import { makeBreath, newNaturalState, planSpeech, speedJitter, type NaturalState } from './natural'
import { pickReaction, splitReactions } from './reactions'

/**
 * The tutor's voice: one queue for the whole app.
 *
 * Text is split into sentence-sized clips, each clip is synthesised by the
 * server's Piper voice, and clips play back-to-back through one AudioContext.
 * The next clip is fetched while the current one plays, so a reply starts
 * quickly and then continues without gaps.
 *
 * Cancellation is explicit and per session. Nothing here cancels speech as a
 * side effect of a component re-rendering. A "session" is one reply; cancelling
 * a session drops its queued clips and stops its clip, and nothing else.
 *
 * If the server voice is unavailable, each clip falls back to the browser's
 * built-in speech so the tutor still talks.
 */

export interface SpeakOptions extends TtsRequest {}

export interface VoiceFrame {
  /** 0..1 loudness of the playing audio, smoothed. */
  amp: number
  /** 24 frequency bands, 0..1, low to high. */
  bands: number[]
}

interface Job {
  session: string
  text: string
  opts: SpeakOptions
  cancelled: boolean
  done: () => void
  clip?: Promise<AudioBuffer | null>
  /** A breath is generated locally, not synthesised. */
  breath?: boolean
  /** A human reaction such as "laugh". Plays a recorded clip, or nothing if none is recorded. */
  reaction?: string
}

const queue: Job[] = []
/** Breath and "um" rhythm, kept per reply session so it runs across the whole reply. */
const rhythm = new Map<string, NaturalState>()
const breaths = new Map<number, AudioBuffer>()
let reactionManifest: Promise<Record<string, string[]>> | null = null
const reactionClips = new Map<string, Promise<AudioBuffer | null>>()
let current: { job: Job; stop: () => void } | null = null
let pumping = false

let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let freq: Uint8Array<ArrayBuffer> | null = null
let wave: Float32Array<ArrayBuffer> | null = null
let rafId = 0
let lastAmp = 0

const frameListeners = new Set<(f: VoiceFrame) => void>()
const BANDS = 24

/** Subscribe to audio-level frames while the tutor is speaking. */
export function subscribeVoiceFrames(fn: (f: VoiceFrame) => void): () => void {
  frameListeners.add(fn)
  return () => frameListeners.delete(fn)
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null
  if (!ctx) {
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.6
    analyser.connect(ctx.destination)
    freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    wave = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
  }
  return ctx
}

function emit(frame: VoiceFrame) {
  frameListeners.forEach((fn) => fn(frame))
}

function frameLoop() {
  if (!analyser || !freq || !wave) {
    rafId = 0
    return
  }
  const playing = current !== null
  if (playing) {
    analyser.getFloatTimeDomainData(wave)
    let sum = 0
    for (let i = 0; i < wave.length; i++) sum += wave[i]! * wave[i]!
    const rms = Math.sqrt(sum / wave.length)
    lastAmp = lastAmp * 0.55 + Math.min(1, rms * 4) * 0.45
    analyser.getByteFrequencyData(freq)
    const per = Math.floor((freq.length * 0.75) / BANDS) // skip the empty top octave
    const bands: number[] = []
    for (let b = 0; b < BANDS; b++) {
      let acc = 0
      for (let i = 0; i < per; i++) acc += freq[b * per + i]!
      bands.push(Math.min(1, acc / per / 200))
    }
    emit({ amp: lastAmp, bands })
    rafId = requestAnimationFrame(frameLoop)
  } else {
    // Let the orb settle to rest, then stop the loop until the next clip.
    lastAmp = 0
    emit({ amp: 0, bands: new Array<number>(BANDS).fill(0) })
    rafId = 0
  }
}

function startFrames() {
  if (!rafId && typeof requestAnimationFrame !== 'undefined') rafId = requestAnimationFrame(frameLoop)
}

/**
 * The pause after a clip, in ms. Piper's own pauses are short, so the playback
 * adds one: longer after a full stop, shorter after a comma, and a little more
 * for a line that ends without punctuation (a board line).
 */
export function clipGapMs(text: string): number {
  const t = text.trim()
  if (/[.!?]["')\]]?$/.test(t)) return 420
  if (/[,;:]$/.test(t)) return 180
  return 300
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Split a reply into clips no longer than `max` characters, at sentence and clause edges. */
export function chunkSpeech(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const pieces: string[] = []
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= max) {
      pieces.push(sentence)
      continue
    }
    let buf = ''
    for (const part of sentence.split(/(?<=[,;:])\s+/)) {
      const joined = buf ? `${buf} ${part}` : part
      if (joined.length <= max) {
        buf = joined
        continue
      }
      if (buf) pieces.push(buf)
      buf = part
      while (buf.length > max) {
        const cut = buf.lastIndexOf(' ', max)
        const at = cut > 0 ? cut : max
        pieces.push(buf.slice(0, at).trim())
        buf = buf.slice(at).trim()
      }
    }
    if (buf) pieces.push(buf)
  }
  // Re-join short neighbours so a reply is not a stutter of two-word clips.
  const out: string[] = []
  for (const p of pieces) {
    const last = out.at(-1)
    if (last && `${last} ${p}`.length <= max) out[out.length - 1] = `${last} ${p}`
    else out.push(p)
  }
  return out
}

/**
 * Speak `text` as part of `session`. Resolves when every clip has finished, or
 * when the session is cancelled. Calls for the same session queue up in order.
 */
export function speakSession(
  session: string,
  text: string,
  opts: SpeakOptions = {},
  kind: 'say' | 'line' = 'say',
): Promise<void> {
  let state = rhythm.get(session)
  if (!state) {
    state = newNaturalState()
    rhythm.set(session, state)
  }
  // Breaths and "um" are planned around the text; each piece is then queued in order.
  const done: Promise<void>[] = []
  // Reaction tags split the text. Each run of words gets its own breaths and markers.
  for (const piece of splitReactions(text)) {
    if (piece.kind === 'react') {
      done.push(
        new Promise<void>((resolve) => {
          queue.push({ session, text: '', opts, cancelled: false, done: resolve, reaction: piece.name })
        }),
      )
      continue
    }
    for (const part of planSpeech(piece.text, kind, state)) {
      if (part.kind === 'breath') {
        done.push(
          new Promise<void>((resolve) => {
            queue.push({ session, text: '', opts, cancelled: false, done: resolve, breath: true })
          }),
        )
        continue
      }
      for (const chunk of chunkSpeech(part.text)) {
        // Each clip gets its own slight speed, so the voice does not sound metronomic.
        const clipOpts = { ...opts, speed: speedJitter(opts.speed ?? 1) }
        done.push(
          new Promise<void>((resolve) => {
            queue.push({ session, text: chunk, opts: clipOpts, cancelled: false, done: resolve })
          }),
        )
      }
    }
  }
  if (done.length === 0) return Promise.resolve()
  void pump()
  return Promise.all(done).then(() => undefined)
}

/** Cancel one session, or every session when none is named. */
export function cancelSpeech(session?: string) {
  const hit = (j: { session: string }) => session === undefined || j.session === session
  if (session === undefined) rhythm.clear()
  else rhythm.delete(session)
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i]!
    if (hit(job)) {
      queue.splice(i, 1)
      job.cancelled = true
      job.done()
    }
  }
  if (current && hit(current.job)) {
    current.job.cancelled = true
    current.stop()
  }
  if (typeof window !== 'undefined') {
    // The browser fallback has no per-session handle, so only silence it when
    // nothing from another session is still queued.
    if (queue.length === 0 && !current) window.speechSynthesis?.cancel()
  }
}

/** Stop everything. Used when the student starts speaking or types a new question. */
export function stopTutorVoice() {
  cancelSpeech()
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (queue.length > 0) {
      const job = queue.shift()!
      // Fetch the next clip while this one plays.
      const next = queue[0]
      if (next && !next.clip && !next.cancelled && !next.breath && !next.reaction) next.clip = fetchClip(next)
      current = { job, stop: () => undefined }
      startFrames()
      try {
        await playJob(job)
      } catch (e) {
        console.warn('[sabi] could not play a clip:', e)
      }
      current = null
      // A breath between clips, so sentences do not run together. Cancelled clips skip it.
      if (!job.cancelled) await delay(job.breath ? 60 : job.reaction ? 120 : clipGapMs(job.text))
      job.done()
    }
  } finally {
    pumping = false
  }
}

async function fetchClip(job: Job): Promise<AudioBuffer | null> {
  try {
    const audio = ensureContext()
    if (!audio) return null
    const bytes = await postTts(job.text, job.opts)
    return await audio.decodeAudioData(bytes)
  } catch (e) {
    console.warn('[sabi] server voice unavailable for this clip, using the browser voice:', e)
    return null
  }
}

async function playJob(job: Job): Promise<void> {
  if (job.cancelled) return
  if (job.breath) {
    const audio = ensureContext()
    if (audio) await playBuffer(breathBuffer(audio))
    return
  }
  if (job.reaction) {
    const clip = await reactionClip(job.reaction)
    if (clip && !job.cancelled) await playBuffer(clip)
    return
  }
  const clip = job.clip ?? fetchClip(job)
  job.clip = clip
  const buffer = await clip
  if (job.cancelled) return
  if (buffer) {
    await playBuffer(buffer)
  } else {
    await playBrowser(job)
  }
}

/** The reactions manifest, fetched once. If it is missing, every reaction is silent. */
function loadManifest(): Promise<Record<string, string[]>> {
  if (!reactionManifest) {
    reactionManifest = fetch(`${import.meta.env.BASE_URL}reactions/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string[]>>) : {}))
      .catch(() => ({}))
  }
  return reactionManifest
}

/** Decode one reaction clip, picked at random from those recorded for it. Cached per file. */
function reactionClip(name: string): Promise<AudioBuffer | null> {
  return loadManifest().then((manifest) => {
    const file = pickReaction(manifest, name)
    if (!file) return null
    let clip = reactionClips.get(file)
    if (!clip) {
      clip = (async () => {
        try {
          const audio = ensureContext()
          if (!audio) return null
          const res = await fetch(`${import.meta.env.BASE_URL}reactions/${file}`)
          if (!res.ok) return null
          return await audio.decodeAudioData(await res.arrayBuffer())
        } catch (e) {
          console.warn('[sabi] could not load reaction', file, e)
          return null
        }
      })()
      reactionClips.set(file, clip)
    }
    return clip
  })
}

/** The breath sample for this device's sample rate, made once and reused. */
function breathBuffer(audio: AudioContext): AudioBuffer {
  const rate = audio.sampleRate
  let buf = breaths.get(rate)
  if (!buf) {
    buf = audio.createBuffer(1, Math.floor(rate * 0.8), rate)
    buf.copyToChannel(makeBreath(rate, 0.8), 0)
    breaths.set(rate, buf)
  }
  return buf
}

function playBuffer(buffer: AudioBuffer): Promise<void> {
  const audio = ensureContext()
  if (!audio || !analyser) return Promise.resolve()
  void audio.resume()
  return new Promise<void>((resolve) => {
    const src = audio.createBufferSource()
    src.buffer = buffer
    src.connect(analyser!)
    const finish = () => resolve()
    src.onended = finish
    if (current) {
      current.stop = () => {
        try {
          src.stop()
        } catch {
          /* already ended */
        }
        finish()
      }
    }
    src.start()
  })
}

function playBrowser(job: Job): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve()
      return
    }
    const u = new SpeechSynthesisUtterance(job.text)
    u.lang = 'en-GB'
    u.rate = job.opts.speed ?? 0.95
    const finish = () => resolve()
    u.onend = finish
    u.onerror = finish
    if (current) {
      current.stop = () => {
        window.speechSynthesis.cancel()
        finish()
      }
    }
    window.speechSynthesis.speak(u)
  })
}

/** Speak a short sample so the student can hear a voice before choosing it. */
export async function playSample(voice: string, accent: string, speed: number): Promise<void> {
  const session = `sample-${Date.now()}`
  await speakSession(
    session,
    'Good afternoon. Delta U equals Q minus W. Explain the first law in your own words.',
    { voice: voice || undefined, accent, speed },
  )
}
