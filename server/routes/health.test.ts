import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceClient, VoiceStatus } from '../voice/client.ts'
import { createHealthHandler } from './health.ts'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

async function readHealth(voice: VoiceClient) {
  const handler = createHealthHandler({ voice })
  server = createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server!.listen(0, r))
  const addr = server!.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`)
  return {
    status: res.status,
    body: (await res.json()) as {
      asr: { state: string; models?: { id: string; label: string }[]; defaultModel?: string }
    },
  }
}

function voiceWith(status: VoiceStatus): VoiceClient {
  return {
    transcribe: async () => '',
    warm: async () => undefined,
    synthesize: async () => ({ pcm: new Float32Array(0), sampleRate: 24000 }),
    status: () => status,
    dispose: async () => undefined,
  }
}

describe('GET /api/health', () => {
  it('reports the worker state', async () => {
    const { status, body } = await readHealth(
      voiceWith({ asr: { state: 'cold', progress: 0 }, tts: { state: 'cold', progress: 0 } }),
    )
    expect(status).toBe(200)
    expect(body.asr).toMatchObject({ state: 'cold', progress: 0 })
  })

  it('is 200 even when the worker is in error, so the UI can render the reason', async () => {
    const { status, body } = await readHealth(
      voiceWith({ asr: { state: 'error', progress: 0, error: 'boom' }, tts: { state: 'cold', progress: 0 } }),
    )
    expect(status).toBe(200)
    expect(body.asr).toMatchObject({ state: 'error' })
  })

  it('carries the selectable models and the server default, so the drawer can render them', async () => {
    const { body } = await readHealth(voiceWith({ asr: { state: 'cold', progress: 0 }, tts: { state: 'cold', progress: 0 } }))
    expect(body.asr.models?.map((m) => m.id)).toContain('Xenova/whisper-base')
    expect(body.asr.models?.some((m) => m.id === body.asr.defaultModel)).toBe(true)
  })

  it('reports the TTS state and the Piper voices', async () => {
    const { body } = await readHealth(
      voiceWith({ asr: { state: 'cold', progress: 0 }, tts: { state: 'ready', progress: 100 } }),
    )
    const tts = (body as unknown as { tts: { state: string; voices: { id: string }[]; defaultVoice: string } }).tts
    expect(tts.state).toBe('ready')
    expect(tts.voices.map((v) => v.id)).toContain(tts.defaultVoice)
  })
})

