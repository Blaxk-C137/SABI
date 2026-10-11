import fs from 'node:fs'
import path from 'node:path'
import { isPiperVoice } from './voices.ts'

/**
 * Where Piper's files live, under the model directory:
 *
 *   <modelDir>/piper/<voice>.onnx (+ .onnx.json)   the voices
 *   <modelDir>/piper-venv/                         a Python venv with piper-tts
 *
 * Piper is a Python package, so the venv is what makes `npm run models:install`
 * set up the synthesiser, not only the voices. SABI_PIPER_PYTHON overrides the
 * interpreter for anyone who already has piper-tts installed.
 */
export function piperVoiceDir(modelDir: string): string {
  return path.join(modelDir, 'piper')
}

export function piperVoiceFile(modelDir: string, voice: string): string {
  return path.join(piperVoiceDir(modelDir), `${voice}.onnx`)
}

export function piperVenvDir(modelDir: string): string {
  return path.join(modelDir, 'piper-venv')
}

export function piperPython(modelDir: string): string {
  if (process.env.SABI_PIPER_PYTHON) return process.env.SABI_PIPER_PYTHON
  const venv = piperVenvDir(modelDir)
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python')
}

export function piperWorkerScript(): string {
  return path.join(import.meta.dirname, 'piper_worker.py')
}

/** True when one voice's files and the Python synthesiser are both in place. */
export function piperVoiceInstalled(modelDir: string, voice: string): boolean {
  if (!isPiperVoice(voice)) return false
  const onnx = piperVoiceFile(modelDir, voice)
  return fs.existsSync(onnx) && fs.existsSync(`${onnx}.json`) && fs.existsSync(piperPython(modelDir))
}
