export interface AsrStatus {
  state: 'cold' | 'loading' | 'ready' | 'error'
  progress: number
  error?: string
}

/** A Whisper model the server will load. Ordered as the server lists them. */
export interface AsrModel {
  id: string
  label: string
}

/**
 * The status plus what the picker needs. The list travels with `/api/health`
 * rather than being duplicated here, so `src/` never imports from `server/` and
 * the two cannot drift apart.
 */
export interface AsrInfo extends AsrStatus {
  models?: AsrModel[]
  defaultModel?: string
}

/** A Piper voice the server will speak with. */
export interface TtsVoice {
  id: string
  label: string
  accent: string
  gender: string
}

export interface TtsInfo extends AsrStatus {
  voices?: TtsVoice[]
  defaultVoice?: string
}

export interface Health {
  ok: boolean
  asr: AsrInfo
  tts?: TtsInfo
}

async function errorFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    /* not JSON */
  }
  return `Request failed with status ${res.status}.`
}

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(await errorFrom(res))
  return (await res.json()) as Health
}

/** Send 16 kHz mono PCM and get the transcript. Mirrors the server's own guard. */
export async function postAsr(pcm: Float32Array, model?: string): Promise<string> {
  if (pcm.length < 1600) {
    throw new Error('Recording too short. Hold the mic and speak a full sentence.')
  }
  // Omitted entirely when no model is named, so the server's default applies
  // and an empty setting never becomes an invalid query value.
  const url = model ? `/api/asr?model=${encodeURIComponent(model)}` : '/api/asr'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    // Pass the view, not `pcm.buffer`: fetch sends exactly the view's bytes,
    // whereas `.buffer` would send the whole backing buffer for a subarray.
    //
    // The cast is required, and it narrows a type-level default rather than
    // papering over a real mismatch. `Float32Array`'s type argument defaults to
    // `ArrayBufferLike`, which admits a view over a SharedArrayBuffer, while
    // `BodyInit`'s `BufferSource` is `ArrayBufferView<ArrayBuffer> | ArrayBuffer`
    // (lib.dom.d.ts). Every value that reaches here is a plain Float32Array over
    // a regular ArrayBuffer, so `BodyInit` states the type fetch already
    // requires. Do not "simplify" this to `pcm.buffer` — that is the bug the
    // comment above describes.
    body: pcm as BodyInit,
  })
  if (!res.ok) throw new Error(await errorFrom(res))
  const body = (await res.json()) as { text?: string }
  const text = (body.text ?? '').trim()
  if (!text) throw new Error('Whisper heard silence. Speak closer to the mic.')
  return text
}

/** The line under the orb. Null means show nothing. */
export function describeAsrProgress(
  status: AsrStatus | null,
  label = 'Whisper',
): string | null {
  if (!status) return null
  if (status.state === 'error') return status.error ?? 'Voice backend error.'
  if (status.state === 'loading') return `${label} · ${Math.round(status.progress)}%`
  return null
}


export interface TtsRequest {
  voice?: string
  accent?: string
  speed?: number
}

/**
 * Synthesise one clip with the server's Piper voice and return WAV bytes.
 * One sentence-sized clip per call: the speech queue plays them in order.
 */
export async function postTts(text: string, opts: TtsRequest = {}, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...opts }),
    signal,
  })
  if (!res.ok) throw new Error(await errorFrom(res))
  return res.arrayBuffer()
}
