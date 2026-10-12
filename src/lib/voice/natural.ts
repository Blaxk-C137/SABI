/**
 * Makes the tutor sound like a person talking rather than reading a script.
 * It only plans; tutor-speak.ts plays the breaths and speaks the words.
 *
 * What it adds to the spoken text, all kept light:
 * - Discourse markers at the start of some sentences: "Right,", "So,", "Okay,",
 *   "Hmm,", "Um,", "Uh,", "Now,", "Yeah,", "You know,". Never two in a row, and
 *   never on a board line, so formulas are not broken up.
 * - Breaths after roughly every 16 to 30 spoken words, and before the first
 *   sentence after a board, as if the tutor has just finished writing.
 * - A slight change of speaking speed for each clip.
 *
 * Check-in questions ("Do you understand?", "Are you following?") are content,
 * so the tutor writes them. The prompt asks for them. See CHECK_INS below.
 */

export type SpeechPart = { kind: 'speech'; text: string } | { kind: 'breath' }

export interface NaturalState {
  /** Words spoken since the last breath. */
  words: number
  /** Breath when `words` reaches this. */
  breakAt: number
  /** True once anything has been spoken in this session. */
  started: boolean
  /** True when the last thing spoken was a board line. */
  afterBoard: boolean
  /** True when the previous sentence already began with a marker. */
  lastMarker: boolean
}

type Rng = () => number

/** Discourse markers a real speaker uses. Spoken as plain words by the voice. */
export const MARKERS = ['Right,', 'So,', 'Okay,', 'Hmm,', 'Um,', 'Uh,', 'Now,', 'Yeah,', 'You know,'] as const

/**
 * Check-ins the tutor may use as its own words. Listed here so the prompt and
 * the tests share one source. Slang is kept to a rare nod.
 */
export const CHECK_INS = [
  'Do you understand?',
  'Are you following?',
  'Make sense so far?',
  'Does that make sense?',
  'Got it?',
  'Aight, bet?',
] as const

function nextBreakAt(rng: Rng): number {
  return 16 + Math.floor(rng() * 15)
}

export function newNaturalState(rng: Rng = Math.random): NaturalState {
  return { words: 0, breakAt: nextBreakAt(rng), started: false, afterBoard: false, lastMarker: false }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** "Right, The answer" -> "Right, the answer", but leave symbols and acronyms alone. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text
}

/**
 * Plan one piece of speech. `kind` is 'say' for tutor speech and 'line' for a
 * board line. Mutates `state` so the rhythm carries across the reply.
 */
export function planSpeech(
  text: string,
  kind: 'say' | 'line',
  state: NaturalState,
  rng: Rng = Math.random,
): SpeechPart[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
  const parts: SpeechPart[] = []

  if (kind === 'line') {
    for (const s of sentences) {
      parts.push({ kind: 'speech', text: s })
      state.words += countWords(s)
    }
    state.afterBoard = true
    state.started = true
    state.lastMarker = false
    return parts
  }

  sentences.forEach((sentence, i) => {
    const first = i === 0
    let body = sentence

    const breathNow = state.words >= state.breakAt || (first && state.afterBoard && rng() < 0.6)
    if (breathNow) {
      parts.push({ kind: 'breath' })
      state.words = 0
      state.breakAt = nextBreakAt(rng)
    }

    // Opening markers: more common at the start of a reply, never back to back.
    const chance = first && !state.started ? 0.45 : 0.14
    if (!state.lastMarker && rng() < chance) {
      const marker = MARKERS[Math.floor(rng() * MARKERS.length)]!
      body = `${marker} ${lowerFirst(body)}`
      state.lastMarker = true
    } else {
      state.lastMarker = false
    }

    parts.push({ kind: 'speech', text: body })
    state.words += countWords(body)
    state.started = true
    state.afterBoard = false
  })

  return parts
}

/** A small random change to speaking speed, so clips do not sound metronomic. */
export function speedJitter(base: number, rng: Rng = Math.random): number {
  return base * (0.96 + rng() * 0.08)
}

/**
 * A soft breath as mono samples: shaped noise that swells in and fades out, like
 * a short inhale and exhale. Quiet on purpose; the voice must stay in front.
 * Pure, so it can be tested without an audio context.
 */
export function makeBreath(
  sampleRate: number,
  durationSec = 0.8,
  rng: Rng = Math.random,
): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.floor(sampleRate * durationSec))
  const out = new Float32Array(new ArrayBuffer(n * 4))
  let a = 0
  let b = 0
  let energy = 0
  for (let i = 0; i < n; i++) {
    // Two cascaded low-pass stages take the hiss down to breath-like tones.
    a = a * 0.6 + (rng() * 2 - 1) * 0.4
    b = b * 0.6 + a * 0.4
    const t = i / n
    const env = Math.sin(Math.PI * t) ** 2 // swell, then fade
    out[i] = b * env
    energy += out[i]! * out[i]!
  }
  // Normalise to a steady, quiet level.
  const rms = Math.sqrt(energy / n) || 1
  const gain = 0.035 / rms
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain
  return out
}
