import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError, readBody, sendError } from '../http.ts'
import type { VoiceClient } from '../voice/client.ts'
import { encodeWav, DEFAULT_TTS_RATE } from '../voice/wav.ts'
import { clampSpeed, isPiperVoice } from '../voice/voices.ts'

/** Longest text one request may synthesise. The browser splits replies well below this. */
export const MAX_TTS_CHARS = 1500

interface TtsBody {
  text?: unknown
  voice?: unknown
  accent?: unknown
  speed?: unknown
}

/** Validate the JSON body. Anything malformed is a 400 before the worker is touched. */
export function parseTtsBody(raw: Buffer): { text: string; voice?: string; accent?: string; speed: number } {
  let body: TtsBody
  try {
    body = JSON.parse(raw.toString('utf8')) as TtsBody
  } catch {
    throw new HttpError(400, 'Body must be JSON.')
  }
  if (typeof body.text !== 'string' || !body.text.trim()) {
    throw new HttpError(400, 'Nothing to speak.')
  }
  if (body.text.length > MAX_TTS_CHARS) {
    throw new HttpError(413, `Text exceeds ${MAX_TTS_CHARS} characters. Split it into sentences.`)
  }
  let voice: string | undefined
  if (typeof body.voice === 'string' && body.voice) {
    // An id that no longer ships (for example a Kokoro id from older saved settings) falls back
    // to the accent's voice rather than failing every reply.
    voice = isPiperVoice(body.voice) ? body.voice : undefined
  }
  const accent = typeof body.accent === 'string' ? body.accent : undefined
  const speed = clampSpeed(typeof body.speed === 'number' ? body.speed : undefined)
  return { text: body.text.trim(), voice, accent, speed }
}

export function createTtsHandler(deps: { voice: VoiceClient }) {
  return async function handleTts(req: IncomingMessage, res: ServerResponse) {
    try {
      const input = parseTtsBody(await readBody(req))
      const { pcm, sampleRate } = await deps.voice.synthesize(input.text, {
        voice: input.voice,
        accent: input.accent,
        speed: input.speed,
      })
      const wav = encodeWav(pcm, sampleRate || DEFAULT_TTS_RATE)
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': wav.length,
        'Cache-Control': 'no-store',
      })
      res.end(wav)
    } catch (e) {
      if (e instanceof HttpError) {
        sendError(res, e.status, e.message)
        return
      }
      const message = e instanceof Error ? e.message : 'Speech synthesis failed.'
      sendError(res, /nothing to speak/i.test(message) ? 400 : 503, message)
    }
  }
}
