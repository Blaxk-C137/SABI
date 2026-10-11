import type { IncomingMessage, ServerResponse } from 'node:http'

export const MAX_BODY_BYTES = 8 * 1024 * 1024

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

export function sendError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, { error: message })
}

export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > limit) throw new HttpError(413, `Request body exceeds ${limit} bytes.`)
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

/**
 * Interpret a body as little-endian Float32 PCM.
 *
 * Copies rather than viewing, because a stream chunk's byteOffset is usually
 * not 4-byte aligned and Float32Array construction would throw.
 */
export function toFloat32(buf: Buffer): Float32Array {
  if (buf.length === 0) throw new HttpError(400, 'Empty audio body.')
  if (buf.length % 4 !== 0) {
    throw new HttpError(400, 'Audio body must be raw Float32 PCM, a multiple of 4 bytes.')
  }
  const ab = new ArrayBuffer(buf.length)
  new Uint8Array(ab).set(buf)
  return new Float32Array(ab)
}

/**
 * The pathname of a request, or its raw target when it cannot be parsed.
 *
 * `new URL` throws on a malformed `Host` header (`Host: a b`) or on an absolute
 * target with a bad host. A throw inside a request listener is an uncaught
 * exception that kills the process, so route matching must never let one escape.
 */
export function requestPathname(req: IncomingMessage): string {
  const target = req.url ?? '/'
  try {
    return new URL(target, `http://${req.headers.host ?? 'localhost'}`).pathname
  } catch {
    return target
  }
}

