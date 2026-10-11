import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { lengthScale, resolveVoice } from './voices.ts'
import { piperPython, piperVoiceFile, piperWorkerScript } from './piper-paths.ts'

/**
 * The speech channel. Piper runs as a Python worker (piper_worker.py) that
 * keeps its voice loaded between requests. This Node process relays IPC from
 * the server to that worker. It runs in its own process, apart from Whisper,
 * so each runtime has its own memory and nothing downloads at runtime.
 */

const modelDir = process.env.SABI_TTS_MODEL_DIR ?? path.join(process.cwd(), 'server', '.models')

interface WorkerReply {
  id: number
  ok: boolean
  sampleRate?: number
  pcm?: string
  error?: string
  ready?: boolean
}

let worker: ChildProcess | null = null
let stdoutBuffer = ''
const queue: { resolve: (r: WorkerReply) => void; reject: (e: Error) => void }[] = []
let nextId = 1

function failAll(error: Error) {
  for (const waiting of queue.splice(0)) waiting.reject(error)
}

function onLine(line: string) {
  let reply: WorkerReply
  try {
    reply = JSON.parse(line) as WorkerReply
  } catch {
    return // not protocol output
  }
  if (reply.ready) return
  queue.shift()?.resolve(reply)
}

function start(): ChildProcess {
  const python = piperPython(modelDir)
  if (!fs.existsSync(python)) {
    throw new Error('Piper is not installed. Run "npm run models:install" once, then try again.')
  }
  const child = spawn(python, [piperWorkerScript()], { stdio: ['pipe', 'pipe', 'inherit'] })
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    let newline = stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline)
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (line.trim()) onLine(line)
      newline = stdoutBuffer.indexOf('\n')
    }
  })
  child.on('exit', (code) => {
    worker = null
    failAll(new Error(`Piper worker stopped (exit ${code}).`))
  })
  child.on('error', (e) => {
    worker = null
    failAll(new Error(`Piper could not start: ${e.message}`))
  })
  worker = child
  return child
}

/** Send one request and wait for its reply. The worker answers in order, one at a time. */
function call(request: Record<string, unknown>): Promise<WorkerReply> {
  const child = worker ?? start()
  const id = nextId++
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject })
    child.stdin?.write(JSON.stringify({ id, ...request }) + '\n')
  })
}

function toFloat32(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64')
  const out = new Float32Array(bytes.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = bytes.readInt16LE(i * 2) / 32768
  return out
}

interface SynthMessage {
  id: number
  kind: 'tts'
  text: string
  voice?: string
  accent?: string
  speed?: number
}

process.on('message', (msg: SynthMessage) => {
  void (async () => {
    try {
      const voice = resolveVoice(msg.voice, msg.accent)
      const model = piperVoiceFile(modelDir, voice)
      if (!fs.existsSync(model)) {
        throw new Error(`The Piper voice ${voice} is not installed. Run "npm run models:install" once, then try again.`)
      }
      const reply = await call({
        cmd: 'synth',
        model,
        text: msg.text,
        length_scale: lengthScale(msg.speed ?? 1),
      })
      if (!reply.ok || !reply.pcm || !reply.sampleRate) {
        throw new Error(reply.error ?? 'Piper returned no audio.')
      }
      process.send?.({ id: msg.id, ok: true, result: { pcm: toFloat32(reply.pcm), sampleRate: reply.sampleRate } })
    } catch (e) {
      process.send?.({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()
})

// The worker must not outlive this process, or it would hold the voice in memory.
function stopWorker() {
  worker?.kill()
  worker = null
}
process.on('disconnect', () => {
  stopWorker()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopWorker()
  process.exit(0)
})
process.on('exit', stopWorker)
