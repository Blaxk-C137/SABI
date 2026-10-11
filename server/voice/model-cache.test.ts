import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isModelCached } from './model-cache.ts'

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sabi-cache-'))
}

function withWeights(dir: string, modelId: string) {
  const onnx = path.join(dir, modelId, 'onnx')
  fs.mkdirSync(onnx, { recursive: true })
  fs.writeFileSync(path.join(onnx, 'encoder_model_quantized.onnx'), 'weights')
}

describe('isModelCached', () => {
  it('finds weights nested under the model directory', () => {
    const dir = scratch()
    withWeights(dir, 'Xenova/whisper-small')
    expect(isModelCached(dir, 'Xenova/whisper-small')).toBe(true)
  })

  it('is false when nothing has been downloaded', () => {
    expect(isModelCached(scratch(), 'Xenova/whisper-small')).toBe(false)
  })

  // An interrupted download leaves config.json and tokenizer files behind, so
  // the directory's existence proves nothing — only weights mean "cached".
  it('is false for a partial download that has no weights yet', () => {
    const dir = scratch()
    const model = path.join(dir, 'Xenova/whisper-small')
    fs.mkdirSync(model, { recursive: true })
    fs.writeFileSync(path.join(model, 'config.json'), '{}')
    fs.writeFileSync(path.join(model, 'encoder_model_quantized.onnx.tmp.207862.hv3yuu'), 'partial')
    expect(isModelCached(dir, 'Xenova/whisper-small')).toBe(false)
  })
})

