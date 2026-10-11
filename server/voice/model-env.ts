/** The subset of transformers.js's `env` the server sets (Whisper only). */
export interface TransformersEnv {
  cacheDir: string
  localModelPath?: string
  allowLocalModels: boolean
  allowRemoteModels: boolean
}

/**
 * Point transformers.js at the model directory. Remote downloads happen only in
 * the installer (`allowDownload` true there, false at runtime).
 */
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
