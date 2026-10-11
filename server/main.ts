import fs from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { readConfig } from './env.ts'
import { requestPathname } from './http.ts'
import { createAsrHandler } from './routes/asr.ts'
import { createHealthHandler } from './routes/health.ts'
import { createTtsHandler } from './routes/tts.ts'
import { createVoiceClient, realSpawn } from './voice/client.ts'
import { isModelCached } from './voice/model-cache.ts'
import { DEFAULT_ASR_MODEL } from './voice/models.ts'
import { DEFAULT_VOICE } from './voice/voices.ts'
import { piperVoiceInstalled } from './voice/piper-paths.ts'

const config = readConfig()
const voice = createVoiceClient({ modelDir: config.modelDir, spawn: realSpawn })

const handleAsr = createAsrHandler({ voice })
const handleHealth = createHealthHandler({ voice })
const handleTts = createTtsHandler({ voice })

function routes(req: IncomingMessage, res: ServerResponse): boolean {
  const pathname = requestPathname(req)
  if (pathname === '/api/health') {
    handleHealth(req, res)
    return true
  }
  if (pathname === '/api/asr' && req.method === 'POST') {
    void handleAsr(req, res)
    return true
  }
  if (pathname === '/api/tts' && req.method === 'POST') {
    void handleTts(req, res)
    return true
  }
  return false
}

async function main() {
  // Load the weights before the first recording rather than after the student
  // stops speaking: the load costs seconds, and paying it while they are still
  // reading is the difference between a reply that feels immediate and one
  // that does not.
  //
  // Only when the weights are already on disk. A cold cache is left alone so a
  // fresh clone does not silently start a large download at boot — the first
  // recording triggers it, with progress shown in the caption.
  //
  // This warms the default model. A student who picks the other one pays its
  // load on their first recording, since the server cannot know the browser's
  // setting before a request arrives.
  if (isModelCached(config.modelDir, DEFAULT_ASR_MODEL)) {
    void voice.warm().catch((e: unknown) => {
      console.warn(
        '[sabi] whisper preload failed, so it will load on the first recording:',
        e instanceof Error ? e.message : e,
      )
    })
  }
  // Piper is preloaded the same way: only when its voice and synthesiser are already installed.
  if (piperVoiceInstalled(config.modelDir, DEFAULT_VOICE)) {
    void voice.synthesize('Ready.').catch((e: unknown) => {
      console.warn('[sabi] Piper preload failed, so it will load on first speech:', e instanceof Error ? e.message : e)
    })
  }

  if (config.production) {
    const dist = path.join(process.cwd(), 'dist')
    if (!fs.existsSync(dist)) {
      throw new Error(`No production bundle at ${dist}. Run "npm run build" first.`)
    }
    const serveStatic = await import('./static.ts')
    createServer((req, res) => {
      if (routes(req, res)) return
      serveStatic.serveFrom(dist, req, res)
    }).listen(config.port, announce)
    return
  }

  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  const server = createServer((req, res) => {
    if (routes(req, res)) return
    vite.middlewares(req, res)
  })
  server.listen(config.port, announce)
}

function announce() {
  console.log(`[sabi] listening on http://localhost:${config.port}`)
  console.log(`[sabi] models cache: ${config.modelDir}`)
}

async function shutdown() {
  await voice.dispose()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

main().catch((e: unknown) => {
  console.error('[sabi] failed to start:', e instanceof Error ? e.message : e)
  process.exit(1)
})

