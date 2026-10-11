import { describe, expect, it } from 'vitest'
import { readSseText } from './client'

const enc = new TextEncoder()

/** A Response whose body replays `chunks` verbatim, one network read each. */
function sse(...chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function textFrame(text: string, delim: string) {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}${delim}`
}

async function read(res: Response) {
  const out: string[] = []
  for await (const chunk of readSseText(res)) out.push(chunk)
  return out
}

describe('readSseText', () => {
  // The SSE spec allows LF, CR and CRLF as line terminators, and Gemini's
  // `alt=sse` streams use CRLF. A parser that knows only one of the three
  // yields nothing at all for the other two — an empty tutor reply.
  it('reads LF-framed events', async () => {
    const res = sse(textFrame('Hello', '\n\n'), textFrame(' world', '\n\n'))
    expect(await read(res)).toEqual(['Hello', ' world'])
  })

  it('reads CRLF-framed events', async () => {
    const res = sse(textFrame('Hello', '\r\n\r\n'), textFrame(' world', '\r\n\r\n'))
    expect(await read(res)).toEqual(['Hello', ' world'])
  })

  it('reads CR-framed events', async () => {
    const res = sse(textFrame('Hello', '\r\r'), textFrame(' world', '\r\r'))
    expect(await read(res)).toEqual(['Hello', ' world'])
  })

  it('reassembles a delimiter split across two network reads', async () => {
    const res = sse(`${textFrame('Hello', '\r\n\r')}`, '\n')
    expect(await read(res)).toEqual(['Hello'])
  })

  it('skips frames that carry no text', async () => {
    const silent = 'data: {"candidates":[{"finishReason":"STOP"}]}\r\n\r\n'
    const res = sse(silent, textFrame('Hello', '\r\n\r\n'))
    expect(await read(res)).toEqual(['Hello'])
  })
})

