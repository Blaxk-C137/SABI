import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpError, MAX_BODY_BYTES, readBody, requestPathname, toFloat32 } from './http.ts'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

/** Start a throwaway server whose handler just returns how many bytes it read. */
async function bodyCounter(limit?: number) {
  server = createServer(async (req, res) => {
    try {
      const buf = await readBody(req, limit)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ bytes: buf.length }))
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      res.writeHead(status)
      res.end(e instanceof Error ? e.message : 'error')
    }
  })
  await new Promise<void>((r) => server!.listen(0, r))
  const addr = server!.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return `http://127.0.0.1:${addr.port}`
}

describe('readBody', () => {
  it('reads a complete body', async () => {
    const url = await bodyCounter()
    const res = await fetch(url, { method: 'POST', body: Buffer.alloc(64, 7) })
    expect(await res.json()).toEqual({ bytes: 64 })
  })

  it('rejects a body over the limit with 413', async () => {
    const url = await bodyCounter(32)
    const res = await fetch(url, { method: 'POST', body: Buffer.alloc(1024, 7) })
    expect(res.status).toBe(413)
  })

  it('treats an empty body as zero bytes, not an error', async () => {
    const url = await bodyCounter()
    const res = await fetch(url, { method: 'POST' })
    expect(await res.json()).toEqual({ bytes: 0 })
  })

  it('caps at 8 MiB by default', () => {
    expect(MAX_BODY_BYTES).toBe(8 * 1024 * 1024)
  })
})

describe('toFloat32', () => {
  it('round-trips Float32 samples', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1])
    const out = toFloat32(Buffer.from(input.buffer.slice(0)))
    expect(Array.from(out)).toEqual([0, 0.5, -0.5, 1])
  })

  it('accepts a Buffer at an unaligned byte offset', () => {
    // a real stream chunk is frequently not 4-byte aligned
    const samples = new Float32Array([0.25, 0.75])
    const inner = Buffer.from(samples.buffer.slice(0))
    const unaligned = Buffer.concat([Buffer.alloc(3), inner]).subarray(3)
    expect(Array.from(toFloat32(unaligned))).toEqual([0.25, 0.75])
  })

  it('rejects a body whose length is not a multiple of 4', () => {
    expect(() => toFloat32(Buffer.alloc(7))).toThrow(HttpError)
  })

  it('rejects an empty body', () => {
    expect(() => toFloat32(Buffer.alloc(0))).toThrow(/Empty/)
  })
})

describe('requestPathname', () => {
  /** requestPathname reads only req.url and req.headers.host. */
  function req(url: string | undefined, host?: string): IncomingMessage {
    const headers: Record<string, string> = {}
    if (host !== undefined) headers.host = host
    return { url, headers } as unknown as IncomingMessage
  }

  it('returns a plain path', () => {
    expect(requestPathname(req('/api/health'))).toBe('/api/health')
  })

  it('strips the query string', () => {
    expect(requestPathname(req('/api/asr?x=1'))).toBe('/api/asr')
  })

  it('does not throw and returns the raw target when the Host header is malformed', () => {
    // `new URL(path, 'http://a b')` throws; a throw in a request listener is an
    // uncaught exception that kills the process, which is why this fallback exists.
    let pathname = ''
    expect(() => {
      pathname = requestPathname(req('/api/health', 'a b'))
    }).not.toThrow()
    expect(pathname).toBe('/api/health')
  })

  it('falls back to localhost when there is no Host header', () => {
    expect(requestPathname(req('/api/health'))).toBe('/api/health')
  })

  it('does not throw and returns the raw target when the Host header is empty', () => {
    // '' is not nullish, so `?? 'localhost'` does not apply and the base `http://`
    // is invalid; the raw target (query included) proves the catch path was taken.
    let pathname = ''
    expect(() => {
      pathname = requestPathname(req('/api/asr?x=1', ''))
    }).not.toThrow()
    expect(pathname).toBe('/api/asr?x=1')
  })

  it('does not throw and returns the raw target for an absolute target with a bad host', () => {
    let pathname = ''
    expect(() => {
      pathname = requestPathname(req('http://a b/x'))
    }).not.toThrow()
    expect(pathname).toBe('http://a b/x')
  })

  it('treats a missing url as the root path', () => {
    expect(requestPathname(req(undefined))).toBe('/')
  })
})

