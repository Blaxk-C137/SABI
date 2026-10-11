/**
 * The Whisper models Sabi may load, and the only ids the server will accept.
 *
 * The list lives here rather than in the browser so `src/` never imports across
 * the `src`/`server` boundary — the frontend reads it from `/api/health`, the
 * same way the harness drawer learns everything else about the backend.
 *
 * Trade-off, measured on a 2015 dual-core i5 at 16 kHz (see the ledger):
 * `small` transcribes a 10 s sentence in ~8 s and gets technical vocabulary
 * right; `base` does it in ~3 s but heard “Q minus double U, the internal
 * enemy” for “Q minus W, the internal energy”. The student picks.
 */
export const ASR_MODELS = [
  { id: 'Xenova/whisper-small', label: 'Whisper small' },
  { id: 'Xenova/whisper-base', label: 'Whisper base' },
  { id: 'Xenova/whisper-tiny', label: 'Whisper tiny' },
] as const

/**
 * Pinned by the spec, and the model the server preloads at boot. `whisper-small`
 * is not on the list by accident: only models named here are ever downloaded.
 */
export const DEFAULT_ASR_MODEL = 'Xenova/whisper-small'

export function isAsrModel(id: string): boolean {
  return ASR_MODELS.some((m) => m.id === id)
}

/**
 * A request's model, or the default when it named none. An id that is not on
 * the list also resolves to the default: the route rejects those with a 400,
 * and this is the belt to that braces.
 */
export function resolveAsrModel(id: string | null | undefined): string {
  return id && isAsrModel(id) ? id : DEFAULT_ASR_MODEL
}

