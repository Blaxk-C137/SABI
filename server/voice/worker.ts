import { parentPort, workerData } from 'node:worker_threads'
import { applyModelEnv, missingModelError, type TransformersEnv } from './model-env.ts'
import { resolveAsrModel } from './models.ts'

/** Whisper options. Short clips skip the chunker; long ones use 20 s chunks with a 4 s stride. */
export function asrOptions(seconds: number): Record<string, unknown> {
  const opts: Record<string, unknown> = { language: 'english', task: 'transcribe' }
  if (seconds > 28) {
    opts.chunk_length_s = 20
    opts.stride_length_s = 4
  }
  return opts
}

export type AsrPipe = (
  audio: Float32Array,
  opts?: Record<string, unknown>,
) => Promise<{ text?: string } | { text?: string }[]>

export type AsrLoader = (id: number, modelId: string) => Promise<AsrPipe>

/**
 * Holds at most one loaded model.
 *
 * Only one is kept because each is hundreds of megabytes: asking for a
 * different model drops the old pipeline so its weights can be collected. A
 * request for the model already in memory reuses it, and two requests for the
 * same model share a single load instead of starting a second download.
 */
export function createAsrCache(load: AsrLoader) {
  let pipe: AsrPipe | null = null
  let currentId: string | null = null
  let loading: { modelId: string; promise: Promise<AsrPipe> } | null = null

  return {
    /** The model currently in memory, or null. */
    current: () => currentId,
    async get(id: number, modelId: string): Promise<AsrPipe> {
      if (pipe && currentId === modelId) return pipe
      if (loading?.modelId === modelId) return loading.promise

      pipe = null
      currentId = null
      const promise = load(id, modelId)
        .then((loaded) => {
          pipe = loaded
          currentId = modelId
          loading = null
          return loaded
        })
        .catch((e: unknown) => {
          loading = null // a later request may retry the load
          throw e
        })
      loading = { modelId, promise }
      return promise
    },
  }
}

let configured = false

async function configure() {
  if (configured) return
  const { env } = await import('@huggingface/transformers')
  // Runtime never downloads. `npm run models:install` fetches the weights.
  applyModelEnv(env as unknown as TransformersEnv, (workerData as { modelDir: string }).modelDir, false)
  configured = true
}

async function loadAsr(id: number, modelId: string): Promise<AsrPipe> {
  await configure()
  const { pipeline } = await import('@huggingface/transformers')
  let pipe: unknown
  try {
    pipe = await pipeline('automatic-speech-recognition', modelId, {
      dtype: 'q8',
      device: 'cpu',
      progress_callback: (info: { status?: string; progress?: number }) => {
        post({ id, type: 'progress', kind: 'asr', progress: info.progress ?? 0, status: info.status ?? '' })
      },
    })
  } catch (e) {
    throw missingModelError(`The Whisper model ${modelId}`, e)
  }
  if (typeof pipe !== 'function') {
    throw new Error('Whisper pipeline did not load as a function.')
  }
  return pipe as unknown as AsrPipe
}

const asrCache = createAsrCache(loadAsr)

async function transcribe(id: number, modelId: string, pcm: Float32Array): Promise<string> {
  const asr = await asrCache.get(id, modelId)
  const result = await asr(pcm, asrOptions(pcm.length / 16000))
  const row = Array.isArray(result) ? result[0] : result
  return (row?.text ?? '').trim()
}

function post(message: unknown) {
  parentPort?.postMessage(message)
}

interface WorkerMessage {
  id: number
  kind: 'asr' | 'warm'
  model?: string
  pcm?: Float32Array
}

// Guarded so this module can be imported in tests, where parentPort is null.
if (parentPort) {
  parentPort.on('message', (msg: WorkerMessage) => {
    void (async () => {
      try {
        const modelId = resolveAsrModel(msg.model)
        if (msg.kind === 'warm') {
          await asrCache.get(msg.id, modelId)
          post({ id: msg.id, ok: true, result: { warm: true } })
          return
        }
        const text = await transcribe(msg.id, modelId, msg.pcm ?? new Float32Array(0))
        post({ id: msg.id, ok: true, result: { text } })
      } catch (e) {
        post({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
  })
}
