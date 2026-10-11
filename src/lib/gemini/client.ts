import { fallbackChatModels } from './models'

export class GeminiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

export async function geminiFetch(path: string, apiKey: string, body: unknown, stream = false) {
  const url = stream ? `${path}?alt=sse` : path
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      detail = j.error?.message || detail
    } catch {
      /* ignore */
    }
    throw new GeminiError(detail, res.status)
  }
  return res
}

// The SSE spec allows LF, CR or CRLF as a line terminator, and Gemini's
// `alt=sse` streams use CRLF. Matching only one of the three drops every
// frame, which renders as an empty reply.
const EVENT_BOUNDARY = /\r\n\r\n|\n\n|\r\r/
const LINE_BREAK = /\r\n|\n|\r/

function* textsIn(block: string): Generator<string> {
  const dataLine = block.split(LINE_BREAK).find((l) => l.startsWith('data:'))
  if (!dataLine) return
  const raw = dataLine.slice(5).trim()
  if (!raw || raw === '[DONE]') return
  let text: string | undefined
  try {
    const json = JSON.parse(raw) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  } catch {
    return /* skip malformed */
  }
  if (text) yield text
}

export async function* readSseText(res: Response) {
  const reader = res.body?.getReader()
  if (!reader) return
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    // The buffer stays raw, so a delimiter split across two reads still
    // reassembles instead of being normalized away.
    let m: RegExpExecArray | null
    while ((m = EVENT_BOUNDARY.exec(buf)) !== null) {
      const block = buf.slice(0, m.index)
      buf = buf.slice(m.index + m[0].length)
      yield* textsIn(block)
    }
  }
  buf += dec.decode()
  if (buf) yield* textsIn(buf)
}

export async function pingGemini(apiKey: string, model: string) {
  let last: unknown
  for (const m of fallbackChatModels(model)) {
    try {
      const res = await geminiFetch(`/v1beta/models/${m}:generateContent`, apiKey, {
        contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
        generationConfig: { maxOutputTokens: 8, temperature: 0 },
      })
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      if (!text) throw new GeminiError('Key accepted but the model returned an empty reply.')
      return text
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new GeminiError('Could not reach a free Gemini model.')
}

