import fs from 'node:fs'
import path from 'node:path'

/**
 * True when the model's weights are already on disk, so loading it costs no download.
 *
 * transformers.js stores weights at `<modelDir>/<modelId>/onnx/*.onnx`, but the
 * exact filenames are its business, not ours — any `.onnx` under the model
 * directory means a previous run finished downloading. The directory alone
 * proves nothing: an interrupted download leaves config and tokenizer files
 * behind with no weights (see the `.tmp.*` files a killed process leaves).
 */
export function isModelCached(modelDir: string, modelId: string): boolean {
  try {
    return fs
      .readdirSync(path.join(modelDir, modelId), { recursive: true })
      .some((entry) => String(entry).endsWith('.onnx'))
  } catch {
    return false
  }
}

