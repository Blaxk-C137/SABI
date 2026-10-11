import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceClient, VoiceStatus } from '../voice/client.ts'
import { createAsrHandler } from './asr.ts'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

function fakeVoice(overrides: Partial<VoiceClient> = {}): VoiceClient {
  const status: VoiceStatus = {
    asr: { state: 'ready', progress: 100 },
    tts: { state: 'cold', progress: 0 },
  }
  return {
    transcribe: async () => 'delta U equals Q minus W',
    warm: async () => undefined,
    synthesize: async () => ({ pcm: new Float32Array(0), sampleRate: 24000 }),
    status: () => status,
    dispose: async () => undefined,
    ...overrides,
  }
}

async function serve(voice: VoiceClient) {
  const handler = createAsrHandler({ voice })
  server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((r) => server!.listen(0, r))
  const addr = server!.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return `http://127.0.0.1:${addr.port}/api/asr`
}

function pcm(samples: number[]) {
  return Buffer.from(new Float32Array(samples).buffer)
}

/** A clip long enough that only the model handling can change the outcome. */
const clip = () => pcm(new Array(2000).fill(0.1))

describe('POST /api/asr — model selection', () => {
  it('passes the requested model to the transcriber', async () => {
    const seen: (string | undefined)[] = []
    const url = await serve(
      fakeVoice({
        transcribe: async (_pcm, model) => {
          seen.push(model)
          return 'ok'
        },
      }),
    )
    await fetch(`${url}?model=Xenova/whisper-base`, { method: 'POST', body: clip() })
    expect(seen).toEqual(['Xenova/whisper-base'])
  })

  it('sends no model when the request names none, so the server default applies', async () => {
    const seen: (string | undefined)[] = []
    const url = await serve(
      fakeVoice({
        transcribe: async (_pcm, model) => {
          seen.push(model)
          return 'ok'
        },
      }),
    )
    await fetch(url, { method: 'POST', body: clip() })
    expect(seen).toEqual([undefined])
  })

  it('refuses an unlisted model with 400 instead of downloading it', async () => {
    // The query string is caller-controlled; without this the downloader would
    // fetch whatever repository the caller named.
    const url = await serve(fakeVoice())
    const res = await fetch(`${url}?model=Xenova/whisper-large-v3`, { method: 'POST', body: clip() })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/unknown whisper model/i)
  })

  it('refuses a traversal attempt in the model parameter', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(`${url}?model=${encodeURIComponent('../../etc/passwd')}`, {
      method: 'POST',
      body: clip(),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/asr', () => {
  it('returns the transcript for valid PCM', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.1)) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ text: 'delta U equals Q minus W' })
  })

  it('measures elapsed time rather than reporting a constant', async () => {
    // The stub sleeps 25 ms and the route measures that, so a hardcoded `ms: 0` fails this.
    const slow = fakeVoice({
      transcribe: async () => {
        await new Promise((r) => setTimeout(r, 25))
        return 'delta U equals Q minus W'
      },
    })
    const url = await serve(slow)
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.1)) })
    expect(((await res.json()) as { ms: number }).ms).toBeGreaterThanOrEqual(15)
  })

  it('rejects a body whose length is not a multiple of 4 with 400', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST', body: Buffer.alloc(7) })
    expect(res.status).toBe(400)
  })

  it('rejects an empty body with 400', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('surfaces the silence message with 422', async () => {
    const url = await serve(
      fakeVoice({
        transcribe: async () => {
          throw new Error('Whisper heard silence. Speak closer to the mic.')
        },
      }),
    )
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.001)) })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toMatch(/silence/i)
  })

  it('surfaces a short-recording message with 400', async () => {
    const url = await serve(
      fakeVoice({
        transcribe: async () => {
          throw new Error('Whisper got almost no audio. Check the microphone and try again.')
        },
      }),
    )
    const res = await fetch(url, { method: 'POST', body: pcm([0, 0, 0, 0]) })
    expect(res.status).toBe(400)
  })

  it('returns 503 while the model is unavailable', async () => {
    const url = await serve(
      fakeVoice({
        transcribe: async () => {
          throw new Error('the voice worker stopped unexpectedly')
        },
      }),
    )
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.1)) })
    expect(res.status).toBe(503)
  })
})

