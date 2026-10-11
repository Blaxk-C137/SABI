import { Worker } from 'node:worker_threads'
import { fork } from 'node:child_process'
import path from 'node:path'

export type VoiceState = 'cold' | 'loading' | 'ready' | 'error'

export interface SlotStatus {
  state: VoiceState
  progress: number
  error?: string
}

export interface VoiceStatus {
  asr: SlotStatus
  tts: SlotStatus
}

export interface Synthesis {
  pcm: Float32Array
  sampleRate: number
}

export interface VoiceClient {
  transcribe(pcm: Float32Array, model?: string): Promise<string>
  warm(model?: string): Promise<void>
  synthesize(
    text: string,
    opts?: { voice?: string; accent?: string; speed?: number },
  ): Promise<Synthesis>
  status(): VoiceStatus
  dispose(): Promise<void>
}

export interface WorkerLike {
  postMessage(value: unknown, transfer?: readonly ArrayBuffer[]): void
  on(event: string, listener: (arg: never) => void): unknown
  terminate(): Promise<number>
}

export type SpawnWorker = (modelDir: string) => WorkerLike

export const realSpawn: SpawnWorker = (modelDir) =>
  new Worker(path.join(import.meta.dirname, 'worker.ts'), { workerData: { modelDir } }) as unknown as WorkerLike

/**
 * Piper gets its own process: it runs as a Python worker, and its onnxruntime
 * cannot share a process with Whisper's.
 * `serialization: 'advanced'` lets the Float32Array audio cross the IPC pipe intact.
 */
export const realSpawnTts: SpawnWorker = (modelDir) => {
  const child = fork(path.join(import.meta.dirname, 'tts-child.ts'), [], {
    env: { ...process.env, SABI_TTS_MODEL_DIR: modelDir },
    execArgv: [],
    serialization: 'advanced',
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  return {
    postMessage: (value) => {
      child.send(value as never)
    },
    on: (event, listener) => child.on(event, listener as never),
    terminate: async () => {
      child.kill()
      return 0
    },
  }
}

type Slot = 'asr' | 'tts'

interface Pending {
  resolve: (value: never) => void
  reject: (err: Error) => void
  slot: Slot
}

interface WorkerMessage {
  id?: number
  type?: string
  kind?: 'asr' | 'tts'
  progress?: number
  ok?: boolean
  result?: { text?: string; pcm?: Float32Array; sampleRate?: number }
  error?: string
}

export function createVoiceClient(opts: {
  modelDir: string
  spawn?: SpawnWorker
  spawnTts?: SpawnWorker
}): VoiceClient {
  const status: VoiceStatus = {
    asr: { state: 'cold', progress: 0 },
    tts: { state: 'cold', progress: 0 },
  }
  const pending = new Map<number, Pending>()
  let nextId = 1
  let disposed = false

  // One channel per model, each with its own process. Separate channels mean a
  // crash in one leaves the other working, and a slow Whisper transcription
  // never holds up a sentence of speech.
  const channels: Record<Slot, { worker: WorkerLike | null; spawn: SpawnWorker; label: string }> = {
    asr: { worker: null, spawn: opts.spawn ?? realSpawn, label: 'voice' },
    tts: { worker: null, spawn: opts.spawnTts ?? realSpawnTts, label: 'voice' },
  }

  function failSlot(slot: Slot, err: Error) {
    for (const [id, p] of pending) {
      if (p.slot !== slot) continue
      pending.delete(id)
      p.reject(err)
    }
  }

  function ensure(slot: Slot): WorkerLike {
    const ch = channels[slot]
    if (ch.worker) return ch.worker
    const w = ch.spawn(opts.modelDir)
    w.on('message', ((msg: WorkerMessage) => {
      if (typeof msg.id !== 'number') return
      if (msg.type === 'progress') {
        status[slot] = { state: 'loading', progress: Math.round(msg.progress ?? 0) }
        return
      }
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) {
        status[p.slot] = { state: 'ready', progress: 100 }
        p.resolve((msg.result ?? {}) as never)
      } else {
        const message = msg.error ?? 'Voice worker failed.'
        status[p.slot] = { state: 'error', progress: 0, error: message }
        p.reject(new Error(message))
      }
    }) as never)
    w.on('exit', (() => {
      if (disposed || ch.worker !== w) return
      ch.worker = null
      const error = 'The voice worker stopped unexpectedly.'
      status[slot] = { state: 'error', progress: 0, error }
      failSlot(slot, new Error('The voice worker stopped unexpectedly. Try again.'))
    }) as never)
    w.on('error', ((e: Error) => {
      if (disposed || ch.worker !== w) return
      ch.worker = null
      status[slot] = { state: 'error', progress: 0, error: e.message }
      failSlot(slot, e)
    }) as never)
    ch.worker = w
    return w
  }

  function send(
    slot: Slot,
    message: Record<string, unknown>,
    transfer?: ArrayBuffer[],
  ): Promise<{ text?: string; pcm?: Float32Array; sampleRate?: number }> {
    if (disposed) return Promise.reject(new Error('Voice client is disposed.'))
    const w = ensure(slot)
    const id = nextId++
    if (status[slot].state === 'cold') status[slot] = { state: 'loading', progress: 0 }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: never) => void, reject, slot })
      w.postMessage({ id, ...message }, transfer)
    })
  }

  return {
    async transcribe(pcm, model) {
      if (pcm.length < 1600) {
        throw new Error('Whisper got almost no audio. Check the microphone and try again.')
      }
      // pcm.buffer is typed ArrayBufferLike; the wire contract transfers a plain ArrayBuffer.
      const result = await send('asr', { kind: 'asr', model, pcm }, [pcm.buffer as ArrayBuffer])
      const text = (result.text ?? '').trim()
      if (!text) throw new Error('Whisper heard silence. Speak closer to the mic.')
      return text
    },
    async warm(model) {
      await send('asr', { kind: 'warm', model })
    },
    async synthesize(text, o = {}) {
      const clean = text.trim()
      if (!clean) throw new Error('Nothing to speak.')
      const result = await send('tts', {
        kind: 'tts',
        text: clean,
        voice: o.voice,
        accent: o.accent,
        speed: o.speed,
      })
      if (!result.pcm || !result.sampleRate) throw new Error('Speech synthesis returned no audio.')
      return { pcm: result.pcm, sampleRate: result.sampleRate }
    },
    status() {
      return { asr: { ...status.asr }, tts: { ...status.tts } }
    },
    async dispose() {
      disposed = true
      for (const slot of ['asr', 'tts'] as const) {
        failSlot(slot, new Error('Voice client is disposed.'))
        const w = channels[slot].worker
        channels[slot].worker = null
        if (w) await w.terminate().catch(() => undefined)
      }
    },
  }
}
