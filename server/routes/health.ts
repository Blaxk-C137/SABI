import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from '../http.ts'
import type { VoiceClient } from '../voice/client.ts'
import { ASR_MODELS, DEFAULT_ASR_MODEL } from '../voice/models.ts'
import { PIPER_VOICES, DEFAULT_VOICE } from '../voice/voices.ts'

export function createHealthHandler(deps: { voice: VoiceClient }) {
  return function handleHealth(_req: IncomingMessage, res: ServerResponse) {
    // The model and voice lists travel with the status so the browser can render
    // the pickers without importing across the src/server boundary.
    const status = deps.voice.status()
    sendJson(res, 200, {
      ok: true,
      asr: { ...status.asr, models: ASR_MODELS, defaultModel: DEFAULT_ASR_MODEL },
      tts: { ...status.tts, voices: PIPER_VOICES.map((v) => ({ id: v.id, label: v.label, accent: v.accent })), defaultVoice: DEFAULT_VOICE },
    })
  }
}
