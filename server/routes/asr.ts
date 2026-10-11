import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError, readBody, sendError, sendJson, toFloat32 } from '../http.ts'
import type { VoiceClient } from '../voice/client.ts'
import { ASR_MODELS, isAsrModel } from '../voice/models.ts'

/**
 * The `?model=` a request asked for, or undefined to let the worker use its
 * default. An id that is not on the list is refused rather than passed to the
 * downloader: the query string is caller-controlled, and the downloader would
 * otherwise fetch whatever repository it named.
 */
function requestedModel(req: IncomingMessage): string | undefined {
  const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('model')
  if (raw === null) return undefined
  if (!isAsrModel(raw)) {
    const known = ASR_MODELS.map((m) => m.id).join(', ')
    throw new HttpError(400, `Unknown Whisper model "${raw}". Known models: ${known}.`)
  }
  return raw
}

/**
 * Classify a transcription failure into an HTTP status.
 *
 * Short audio and silence are the caller's fault (4xx). A dead or still-loading
 * worker is ours (503) and the client should offer a retry.
 */
function statusFor(message: string): number {
  if (/almost no audio|too short/i.test(message)) return 400
  if (/silence/i.test(message)) return 422
  return 503
}

export function createAsrHandler(deps: { voice: VoiceClient }) {
  return async function handleAsr(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now()
    try {
      const model = requestedModel(req)
      const pcm = toFloat32(await readBody(req))
      const text = await deps.voice.transcribe(pcm, model)
      sendJson(res, 200, { text, ms: Date.now() - started })
    } catch (e) {
      if (e instanceof HttpError) {
        sendError(res, e.status, e.message)
        return
      }
      const message = e instanceof Error ? e.message : 'Transcription failed.'
      sendError(res, statusFor(message), message)
    }
  }
}

