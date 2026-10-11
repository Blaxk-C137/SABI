import path from 'node:path'
import { applyModelEnv } from './model-env.ts'

/**
 * Downloads one Whisper model into the model directory. Run by
 * scripts/install-models.ts, one process per model, so each load is clean.
 *
 *   node server/voice/fetch-model.ts whisper Xenova/whisper-small
 *
 * Piper's voices are plain files and are fetched by scripts/install-models.ts.
 */
const [kind, id] = process.argv.slice(2)
if (kind !== 'whisper' || !id) {
  console.error('usage: fetch-model.ts whisper <model-id>')
  process.exit(2)
}

const modelDir = process.env.SABI_MODEL_DIR ?? path.join(process.cwd(), 'server', '.models')
let lastLine = ''
const progress = (info: { status?: string; file?: string; progress?: number }) => {
  if (info.status !== 'progress' && info.status !== 'done') return
  const line = `  ${info.file ?? ''} ${info.status === 'done' ? '100%' : `${Math.round(info.progress ?? 0)}%`}`
  if (line !== lastLine && info.status === 'done') console.log(line.trimEnd())
  lastLine = line
}

const { env, pipeline } = await import('@huggingface/transformers')
applyModelEnv(env as unknown as Parameters<typeof applyModelEnv>[0], modelDir, true)
await pipeline('automatic-speech-recognition', id, { dtype: 'q8', device: 'cpu', progress_callback: progress })
console.log(`ok ${id}`)
