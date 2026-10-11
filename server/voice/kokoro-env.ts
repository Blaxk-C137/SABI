import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** The subset of transformers.js's `env` the server sets. */
export interface TransformersEnv {
  cacheDir: string
  localModelPath?: string
  allowLocalModels: boolean
  allowRemoteModels: boolean
}

/**
 * kokoro-js imports the ES build of its nested transformers.js. That is a
 * separate instance from the top-level one Whisper uses, with its own cache
 * setting, so it has to be configured on its own.
 */
export async function kokoroTransformersEnv(): Promise<TransformersEnv> {
  const kokoroEntry = createRequire(import.meta.url).resolve('kokoro-js') // .../kokoro-js/dist/kokoro.cjs
  const kokoroRoot = path.resolve(path.dirname(kokoroEntry), '..')
  const esm = path.join(kokoroRoot, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs')
  const file = fs.existsSync(esm) ? esm : createRequire(kokoroEntry).resolve('@huggingface/transformers')
  const mod = (await import(pathToFileURL(file).href)) as { env?: TransformersEnv; default?: { env?: TransformersEnv } }
  const env = mod.env ?? mod.default?.env
  if (!env) throw new Error('Could not reach the transformers.js cache setting used by kokoro-js.')
  return env
}

/** Point a transformers.js instance at the model directory. Remote downloads only happen in the installer. */
export function applyModelEnv(env: TransformersEnv, modelDir: string, allowDownload: boolean) {
  env.cacheDir = modelDir
  env.localModelPath = modelDir
  // transformers.js refuses a configuration with both local and remote disabled, so
  // local lookup stays on. Files already in cacheDir are "local" and load offline.
  env.allowLocalModels = true
  env.allowRemoteModels = allowDownload
}

/** Turn a "not found locally" failure into the one thing the student must do. */
export function missingModelError(name: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  if (/local|not found|could not locate|remote|404/i.test(detail)) {
    return new Error(`${name} is not installed. Run "npm run models:install" once, then try again.`)
  }
  return cause instanceof Error ? cause : new Error(String(cause))
}
