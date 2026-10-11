/**
 * Free-tier Gemini text models only.
 * Sources: https://ai.google.dev/gemini-api/docs/pricing (Oct 2026)
 *          https://ai.google.dev/gemini-api/docs/models
 *
 * Included: Flash / Flash-Lite showing “Free of charge” input & output on the Free tier,
 * listed here only if the model ID also appears on the models page. Pro, TTS, Live,
 * Transcribe, image (Nano Banana), Veo and Lyria are excluded.
 *
 * The 2.5 entries are free but Google restricts them to “users who have actively used
 * them in the past”, so a fresh key gets an error from them. They are kept last — after
 * the 3.x models — so the fallback chain only reaches them if nothing newer answers.
 */
export const FREE_CHAT_MODELS = [
  { id: 'gemini-3.8-flash', label: '3.8 Flash' },
  { id: 'gemini-3.6-flash', label: '3.6 Flash' },
  { id: 'gemini-3.5-flash-lite', label: '3.5 Flash-Lite' },
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite' },
  { id: 'gemini-3-flash-preview', label: '3 Flash (preview)' },
  { id: 'gemini-2.5-flash', label: '2.5 Flash (legacy)' },
  { id: 'gemini-2.5-flash-lite', label: '2.5 Flash-Lite (legacy)' },
] as const

export const DEFAULT_CHAT_MODEL = 'gemini-3.8-flash'

export const FREE_CHAT_IDS = FREE_CHAT_MODELS.map((m) => m.id)

export function isFreeChatModel(id: string) {
  return (FREE_CHAT_IDS as readonly string[]).includes(id)
}

export function fallbackChatModels(preferred: string) {
  const head = isFreeChatModel(preferred) ? preferred : DEFAULT_CHAT_MODEL
  return [...new Set([head, ...FREE_CHAT_IDS])]
}

