import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { requestPathname } from './http.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

/** URL-decode and normalise a request path, tolerating a malformed escape. */
function relativePath(pathname: string): string {
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // a bare '%' or '%zz' is not a valid escape — serve the raw path instead of throwing
  }
  return path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
}

/** Serve a file from `root`, falling back to index.html for SPA routes. */
export function serveFrom(root: string, req: IncomingMessage, res: ServerResponse) {
  const rel = relativePath(requestPathname(req))
  let file = path.join(root, rel)

  // never escape the bundle directory
  if (!file.startsWith(root)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, 'index.html')
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const ext = path.extname(file)
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  // an unhandled 'error' event on the read stream is an uncaught exception
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
}

