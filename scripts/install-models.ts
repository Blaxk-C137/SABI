/**
 * Installs everything the voice needs into server/.models:
 *
 *   - Piper: a Python venv with piper-tts (the synthesiser), plus three English
 *     voices (.onnx + .onnx.json) from rhasspy/piper-voices.
 *   - Whisper: the speech recogniser, small by default.
 *
 *   npm run models:install               Piper + Whisper small
 *   npm run models:all                   also Whisper base and tiny
 *   npm run models:install -- --force    reinstall even if present
 *
 * Runs after `npm install` (see scripts/postinstall.mjs). The app itself never
 * downloads: a missing piece is reported in the app with the command to run.
 *
 * Needs Python 3.9+ for Piper. Set SABI_PYTHON to choose the interpreter.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ASR_MODELS, DEFAULT_ASR_MODEL } from '../server/voice/models.ts'
import { PIPER_RELEASE_URL, PIPER_VOICES } from '../server/voice/voices.ts'
import { piperPython, piperVenvDir, piperVoiceDir, piperVoiceFile } from '../server/voice/piper-paths.ts'

const PIPER_PACKAGE = 'piper-tts==1.8.0'

const args = process.argv.slice(2)
const all = args.includes('--all')
const force = args.includes('--force')
const quiet = args.includes('--postinstall')
const modelDir = process.env.SABI_MODEL_DIR ?? path.join(process.cwd(), 'server', '.models')

let failed = 0
const fail = (message: string) => {
  failed++
  console.error(`✗ ${message}`)
}

/** Run a command and return its output, or null if it could not run or failed. */
function run(cmd: string, cmdArgs: string[], opts: { quiet?: boolean } = {}): string | null {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (r.error || r.status !== 0) return null
  return r.stdout ?? ''
}

/** A system Python 3.9+ that can create a venv, or null. */
function findSystemPython(): string | null {
  const candidates = process.env.SABI_PYTHON
    ? [process.env.SABI_PYTHON]
    : process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python']
  for (const cmd of candidates) {
    const out = run(cmd, ['-c', 'import sys;print(sys.version_info >= (3, 9))'], { quiet: true })
    if (out?.trim() === 'True') return cmd
  }
  return null
}

function installPiper() {
  const python = piperPython(modelDir)
  const importable = run(python, ['-c', 'import piper'], { quiet: true }) !== null
  if (!force && importable) {
    console.log(`✓ Piper synthesiser already installed`)
    return
  }
  if (process.env.SABI_PIPER_PYTHON) {
    fail('SABI_PIPER_PYTHON is set but cannot import piper. Install piper-tts there, or unset it.')
    return
  }
  const system = findSystemPython()
  if (!system) {
    fail('Python 3.9+ was not found. Install it, then run: npm run models:install')
    return
  }
  if (!fs.existsSync(python)) {
    console.log(`↓ creating Python environment in ${piperVenvDir(modelDir)}`)
    if (run(system, ['-m', 'venv', piperVenvDir(modelDir)]) === null) {
      fail('Could not create the Python environment for Piper.')
      return
    }
  }
  console.log(`↓ ${PIPER_PACKAGE}`)
  if (run(python, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', PIPER_PACKAGE]) === null) {
    fail(`pip could not install ${PIPER_PACKAGE}. Check your connection, then run: npm run models:install`)
    return
  }
  console.log('✓ Piper synthesiser installed')
}

async function downloadFile(url: string, dest: string) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${url} returned ${res.status}`)
  const tmp = `${dest}.tmp`
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.writeFile(tmp, Buffer.from(await res.arrayBuffer()))
  await fs.promises.rename(tmp, dest)
}

async function installPiperVoices() {
  for (const voice of PIPER_VOICES) {
    const onnx = piperVoiceFile(modelDir, voice.id)
    if (!force && fs.existsSync(onnx) && fs.existsSync(`${onnx}.json`)) {
      console.log(`✓ ${voice.id} already installed`)
      continue
    }
    if (!voice.hfPath) {
      if (!fs.existsSync(onnx) || !fs.existsSync(`${onnx}.json`)) {
        fail(`${voice.id} is a custom voice: place ${voice.id}.onnx and ${voice.id}.onnx.json in ${piperVoiceDir(modelDir)}`)
      }
      continue
    }
    console.log(`↓ ${voice.id}`)
    try {
      await downloadFile(`${PIPER_RELEASE_URL}${voice.hfPath}.onnx`, onnx)
      await downloadFile(`${PIPER_RELEASE_URL}${voice.hfPath}.onnx.json`, `${onnx}.json`)
      console.log(`✓ ${voice.id}`)
    } catch (e) {
      fail(`${voice.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function installWhisper() {
  const ids = ASR_MODELS.filter((m) => all || m.id === DEFAULT_ASR_MODEL).map((m) => m.id)
  for (const id of ids) {
    if (!force && hasOnnx(path.join(modelDir, id))) {
      console.log(`✓ ${id} already installed`)
      continue
    }
    console.log(`↓ ${id}`)
    const r = spawnSync(process.execPath, ['server/voice/fetch-model.ts', 'whisper', id], {
      stdio: 'inherit',
      env: { ...process.env, SABI_MODEL_DIR: modelDir },
    })
    if (r.status !== 0) fail(`${id} failed (exit ${r.status})`)
  }
}

function hasOnnx(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { recursive: true }).some((entry) => String(entry).endsWith('.onnx'))
  } catch {
    return false
  }
}

await (async () => {
  installPiper()
  await installPiperVoices()
  installWhisper()
})()

if (failed > 0) {
  const msg = `${failed} item(s) failed. Fix the problem above, then run: npm run models:install`
  if (quiet) {
    console.warn(`[sabi] ${msg}`)
    process.exit(0) // a model must not fail npm install; the app says what is missing
  }
  console.error(msg)
  process.exit(1)
}
if (!quiet) console.log(`Voice models ready in ${modelDir}`)
