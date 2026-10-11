# Voice Backend — Phase 1: Backend Skeleton and Whisper ASR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Whisper small speech recognition out of the browser into a local Node process, so the browser stops running ONNX inference and `npm run dev` starts frontend and backend together.

**Architecture:** One Node 24 process on port 5173 hosts Vite in middleware mode plus `/api/*` routes. Whisper runs in a `worker_thread` so CPU-bound inference never stalls HMR or asset serving. The browser keeps `decodeAudioData` and resampling — work it does natively and well — and POSTs raw 16 kHz mono `Float32` PCM to the server.

**Tech Stack:** Node 24.12 (native TypeScript type stripping), `node:http`, `node:worker_threads`, `@huggingface/transformers` 4.3.1, `onnxruntime-node` (already installed), Vite 8, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-voice-backend-design.md`

## Global Constraints

- Node 24.12+ required. Server files run directly via Node's type stripping — **no build step, no `tsx`, no `ts-node`.**
- `erasableSyntaxOnly: true` is set in tsconfig. **No enums, no parameter properties, no namespaces** — they do not strip.
- `verbatimModuleSyntax: true` is set. **Use `import type` for type-only imports.**
- Server ESM imports **must carry explicit `.ts` extensions** (`import { readConfig } from './env.ts'`). Node does not do extension resolution.
- The server tree must never import from `src/`. They are separate compilation units.
- Gemini is **untouched in Phase 1.** The browser key and the Vite `/v1beta` proxy stay exactly as they are.
- No new runtime dependencies in Phase 1. `vitest` is a dev dependency.
- Do not modify `src/lib/course/pipeline.ts` — it is unreferenced but out of scope.
- All user-facing error copy in this phase is reused verbatim from the existing implementation.

## Review Focus

Failure modes the spec implies but that no happy-path test exercises. Each is pinned by a test in the task named.

1. **Two overlapping transcribe requests** (student double-taps the mic). Responses must not cross wires. → Task 4.
2. **Server started with no `.env` present.** Must still serve the UI, not crash at boot. → Task 2, Task 6.
3. **A recording longer than 28 seconds.** Must take the chunked path, not silently truncate. → Task 4.
4. **Near-silent audio.** Must produce the "heard silence" message, not an empty reply or a crash. → Task 5.
5. **A request body over the cap.** Must return 413 rather than buffering without limit. → Task 3.

---

### Task 1: Test harness and PCM conversion

The repo has no test framework. This task adds one, and uses it on the PCM maths that moves to `pcm.ts` — the code most likely to be silently wrong, because a bad resampler produces audio that still *looks* fine.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/voice/pcm.ts`
- Test: `src/lib/voice/pcm.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TARGET_RATE: 16000`, `interface PcmSource`, `mixMono(buf: PcmSource): Float32Array`, `resample(input: Float32Array, from: number, to: number): Float32Array`, `decodeToMono16k(buf: PcmSource): Float32Array`, `blobToMono16k(blob: Blob): Promise<Float32Array>`. Task 8 consumes `blobToMono16k`.

- [ ] **Step 1: Add vitest and the test script**

```bash
npm install -D vitest@^3
```

Then in `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Create the vitest config**

Create `vitest.config.ts`:

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const root = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(root, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
```

Two things about this file are load-bearing.

`environment: 'node'` is deliberate. Tests must not import `vitest/globals`; import `describe`, `it`, `expect` from `'vitest'` explicitly, because `tsconfig.app.json` sets `"types": ["vite/client"]` and globals would not be typed.

The `resolve.alias` entry duplicates the one in `vite.config.ts` on purpose. Vitest uses `vitest.config.ts` **instead of** `vite.config.ts` when it exists — it does not merge them — so the `@` alias would otherwise disappear and any test that transitively imports a module using `@/...` would fail to resolve. Merging the two configs with `mergeConfig` would drag in the React and Tailwind plugins and the Gemini proxy for no benefit in a Node test run.

- [ ] **Step 3: Write the failing tests**

Create `src/lib/voice/pcm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TARGET_RATE, decodeToMono16k, mixMono, resample } from './pcm'

function source(channels: Float32Array[], sampleRate: number) {
  return {
    length: channels[0]!.length,
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: (c: number) => channels[c]!,
  }
}

function sine(hz: number, sampleRate: number, seconds: number) {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return out
}

/** Count upward zero crossings — a cheap, resample-robust frequency probe. */
function zeroCrossings(buf: Float32Array) {
  let count = 0
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1]! <= 0 && buf[i]! > 0) count++
  }
  return count
}

describe('mixMono', () => {
  it('averages two channels', () => {
    const mono = mixMono(source([new Float32Array([1, 0, -1]), new Float32Array([0, 1, -1])], 48000))
    expect(Array.from(mono)).toEqual([0.5, 0.5, -1])
  })

  it('passes a single channel through unchanged', () => {
    const input = new Float32Array([0.25, -0.5, 0.75])
    expect(Array.from(mixMono(source([input], 16000)))).toEqual([0.25, -0.5, 0.75])
  })
})

describe('resample', () => {
  it('returns the same array when rates match', () => {
    const input = new Float32Array([1, 2, 3])
    expect(resample(input, 16000, 16000)).toBe(input)
  })

  it('produces the expected length when downsampling 48k to 16k', () => {
    const out = resample(new Float32Array(48000), 48000, 16000)
    expect(out.length).toBe(16000)
  })

  it('preserves a constant signal', () => {
    const out = resample(new Float32Array(4800).fill(0.5), 48000, 16000)
    for (const v of out) expect(v).toBeCloseTo(0.5, 6)
  })

  it('keeps a 1 kHz sine near 1 kHz after resampling 48k to 16k', () => {
    const out = resample(sine(1000, 48000, 1), 48000, 16000)
    expect(out.length).toBe(16000)
    // one second of 1 kHz is 1000 cycles either side of the conversion
    expect(zeroCrossings(out)).toBeGreaterThanOrEqual(995)
    expect(zeroCrossings(out)).toBeLessThanOrEqual(1005)
  })
})

describe('decodeToMono16k', () => {
  it('downmixes and resamples in one step', () => {
    const out = decodeToMono16k(source([new Float32Array(48000), new Float32Array(48000)], 48000))
    expect(out.length).toBe(TARGET_RATE)
    for (const v of out) expect(v).toBeCloseTo(0, 6)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib/voice/pcm.test.ts`
Expected: FAIL — `Failed to resolve import "./pcm"`.

- [ ] **Step 5: Write `pcm.ts`**

Create `src/lib/voice/pcm.ts`. `mixMono` and `resample` are moved verbatim from `src/lib/voice/whisper.ts:114-160`, with one change: `mixMono` takes a structural `PcmSource` instead of a DOM `AudioBuffer`, so it is testable under Node.

```ts
export const TARGET_RATE = 16000

/**
 * The subset of AudioBuffer this module needs. Structural so tests can pass a
 * plain object under Node, where no DOM AudioBuffer exists.
 */
export interface PcmSource {
  length: number
  numberOfChannels: number
  sampleRate: number
  getChannelData(channel: number): Float32Array
}

export function mixMono(buf: PcmSource): Float32Array {
  const n = buf.length
  const out = new Float32Array(n)
  const chs = buf.numberOfChannels
  for (let c = 0; c < chs; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < n; i++) out[i]! += data[i]! / chs
  }
  return out
}

export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const outLen = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = x - i0
    out[i] = input[i0]! * (1 - t) + input[i1]! * t
  }
  return out
}

export function decodeToMono16k(buf: PcmSource): Float32Array {
  return resample(mixMono(buf), buf.sampleRate, TARGET_RATE)
}

function audioContext() {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) throw new Error('This browser cannot decode microphone audio.')
  return new AC()
}

function decodeAudio(ctx: AudioContext, buf: ArrayBuffer) {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    try {
      const ret = ctx.decodeAudioData(
        buf,
        (b) => finish(() => resolve(b)),
        (err) => finish(() => reject(err || new Error('Could not decode microphone audio'))),
      )
      if (ret && typeof (ret as Promise<AudioBuffer>).then === 'function') {
        ;(ret as Promise<AudioBuffer>).then(
          (b) => finish(() => resolve(b)),
          (e) => finish(() => reject(e)),
        )
      }
    } catch (e) {
      finish(() => reject(e))
    }
  })
}

/** Decode a recorded blob to 16 kHz mono PCM — the wire format for POST /api/asr. */
export async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const ctx = audioContext()
  const raw = await blob.arrayBuffer()
  const buf = await decodeAudio(ctx, raw.slice(0))
  await ctx.close().catch(() => undefined)
  return decodeToMono16k(buf)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/voice/pcm.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/voice/pcm.ts src/lib/voice/pcm.test.ts
git commit -m "Add vitest and extract browser PCM conversion to pcm.ts

mixMono takes a structural PcmSource rather than a DOM AudioBuffer so the
resampling maths is testable under Node."
```

---

### Task 2: Server configuration

**Files:**
- Create: `server/env.ts`
- Create: `tsconfig.server.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Test: `server/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ServerConfig { port: number; modelDir: string; production: boolean }`, `readConfig(env?: NodeJS.ProcessEnv): ServerConfig`. Tasks 4 and 6 consume `readConfig`.

- [ ] **Step 1: Write the failing tests**

Create `server/env.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readConfig } from './env.ts'

describe('readConfig', () => {
  it('defaults to port 5173 and a model dir under server/', () => {
    const cfg = readConfig({})
    expect(cfg.port).toBe(5173)
    expect(cfg.modelDir).toBe(path.join(process.cwd(), 'server', '.models'))
    expect(cfg.production).toBe(false)
  })

  it('reads PORT from the environment', () => {
    expect(readConfig({ PORT: '8080' }).port).toBe(8080)
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => readConfig({ PORT: 'eighty' })).toThrow(/PORT/)
  })

  it('rejects an out-of-range PORT', () => {
    expect(() => readConfig({ PORT: '70000' })).toThrow(/PORT/)
  })

  it('accepts an absolute SABI_MODEL_DIR override', () => {
    expect(readConfig({ SABI_MODEL_DIR: '/tmp/models' }).modelDir).toBe('/tmp/models')
  })

  it('resolves a relative SABI_MODEL_DIR against the working directory', () => {
    expect(readConfig({ SABI_MODEL_DIR: 'cache' }).modelDir).toBe(path.resolve('cache'))
  })

  it('sets production only for NODE_ENV=production', () => {
    expect(readConfig({ NODE_ENV: 'production' }).production).toBe(true)
    expect(readConfig({ NODE_ENV: 'development' }).production).toBe(false)
  })

  it('succeeds with an empty environment — a missing .env must not crash boot', () => {
    expect(() => readConfig({})).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/env.test.ts`
Expected: FAIL — `Failed to resolve import "./env.ts"`.

- [ ] **Step 3: Write `server/env.ts`**

```ts
import path from 'node:path'

export interface ServerConfig {
  port: number
  modelDir: string
  production: boolean
}

/**
 * Every field has a working default, so a missing .env is not fatal —
 * only an explicitly invalid value throws.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawPort = env.PORT?.trim()
  const port = rawPort ? Number(rawPort) : 5173
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env.PORT}".`)
  }

  const rawDir = env.SABI_MODEL_DIR?.trim()

  return {
    port,
    modelDir: rawDir ? path.resolve(rawDir) : path.join(process.cwd(), 'server', '.models'),
    production: env.NODE_ENV === 'production',
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/env.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Add the server compile unit**

Create `tsconfig.server.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.server.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "skipLibCheck": true,
    "module": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["server"]
}
```

Add it to the root `tsconfig.json` references:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.server.json" }
  ]
}
```

While here, add `vitest.config.ts` to `tsconfig.node.json` so `tsc -b` covers every config file:

```json
  "include": ["vite.config.ts", "vitest.config.ts"]
```

- [ ] **Step 6: Verify the server tree typechecks**

Run: `npx tsc -b`
Expected: exits 0. If it reports `server/env.test.ts` errors, add `"exclude": ["**/*.test.ts"]` to `tsconfig.server.json` — tests are checked by vitest, not by `tsc -b`.

- [ ] **Step 7: Ignore the model cache**

Append to `.gitignore`:

```
# Local model weights (Whisper, Kokoro)
server/.models/
.env
```

- [ ] **Step 8: Commit**

```bash
git add server/env.ts server/env.test.ts tsconfig.server.json tsconfig.json tsconfig.node.json .gitignore
git commit -m "Add server config with defaults that survive a missing .env"
```

---

### Task 3: HTTP helpers

**Files:**
- Create: `server/http.ts`
- Test: `server/http.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAX_BODY_BYTES`, `class HttpError { status: number }`, `sendJson(res, status, body)`, `sendError(res, status, message)`, `readBody(req, limit?): Promise<Buffer>`, `toFloat32(buf: Buffer): Float32Array`. Tasks 5 and 7 consume all of these.

- [ ] **Step 1: Write the failing tests**

Create `server/http.test.ts`:

```ts
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpError, MAX_BODY_BYTES, readBody, toFloat32 } from './http.ts'

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/http.test.ts`
Expected: FAIL — `Failed to resolve import "./http.ts"`.

- [ ] **Step 3: Write `server/http.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/http.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/http.ts server/http.test.ts
git commit -m "Add HTTP helpers with a body size cap and alignment-safe PCM decoding"
```

---

### Task 4: Voice worker and client

Whisper runs in a `worker_thread`. The client owns request correlation, progress reporting, and restart-after-crash. Both are built to be testable: the worker guards its `parentPort` listener so the module can be imported outside a worker, and the client accepts an injected worker factory.

**Files:**
- Create: `server/voice/worker.ts`
- Create: `server/voice/client.ts`
- Test: `server/voice/worker.test.ts`
- Test: `server/voice/client.test.ts`

**Interfaces:**
- Consumes: `ServerConfig.modelDir` (Task 2).
- Produces:
  - `WHISPER_ID = 'Xenova/whisper-small'`
  - `asrOptions(seconds: number): Record<string, unknown>`
  - `type VoiceState = 'cold' | 'loading' | 'ready' | 'error'`
  - `interface VoiceStatus { asr: { state: VoiceState; progress: number; error?: string } }`
  - `interface VoiceClient { transcribe(pcm: Float32Array): Promise<string>; warm(): Promise<void>; status(): VoiceStatus; dispose(): Promise<void> }`
  - `createVoiceClient(opts: { modelDir: string; spawn?: SpawnWorker }): VoiceClient`
  - `realSpawn: SpawnWorker`
  - Tasks 5 and 6 consume `createVoiceClient`, `VoiceClient`, and `realSpawn`.

- [ ] **Step 1: Write the failing worker tests**

Create `server/voice/worker.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { WHISPER_ID, asrOptions } from './worker.ts'

describe('asrOptions', () => {
  it('uses plain transcription for a short clip', () => {
    expect(asrOptions(5)).toEqual({ language: 'english', task: 'transcribe' })
  })

  it('chunks a clip longer than 28 seconds', () => {
    expect(asrOptions(45)).toEqual({
      language: 'english',
      task: 'transcribe',
      chunk_length_s: 20,
      stride_length_s: 4,
    })
  })

  it('takes the chunked path only above the threshold', () => {
    expect(asrOptions(28)).not.toHaveProperty('chunk_length_s')
    expect(asrOptions(28.1)).toHaveProperty('chunk_length_s', 20)
  })
})

describe('model id', () => {
  it('is whisper-small, as the spec pins it', () => {
    expect(WHISPER_ID).toBe('Xenova/whisper-small')
  })
})
```

- [ ] **Step 2: Run the worker tests to verify they fail**

Run: `npx vitest run server/voice/worker.test.ts`
Expected: FAIL — `Failed to resolve import "./worker.ts"`.

- [ ] **Step 3: Write `server/voice/worker.ts`**

```ts
import { parentPort, workerData } from 'node:worker_threads'

export const WHISPER_ID = 'Xenova/whisper-small'

/** Mirrors src/lib/voice/whisper.ts:60-71 — short clips skip the chunker. */
export function asrOptions(seconds: number): Record<string, unknown> {
  const opts: Record<string, unknown> = { language: 'english', task: 'transcribe' }
  if (seconds > 28) {
    opts.chunk_length_s = 20
    opts.stride_length_s = 4
  }
  return opts
}

type AsrPipe = (
  audio: Float32Array,
  opts?: Record<string, unknown>,
) => Promise<{ text?: string } | { text?: string }[]>

let asrPipe: AsrPipe | null = null
let configured = false

async function configure() {
  if (configured) return
  const { env } = await import('@huggingface/transformers')
  env.cacheDir = (workerData as { modelDir: string }).modelDir
  env.allowLocalModels = false
  env.allowRemoteModels = true
  configured = true
}

async function getAsr(id: number): Promise<AsrPipe> {
  if (asrPipe) return asrPipe
  await configure()
  const { pipeline } = await import('@huggingface/transformers')
  const pipe = await pipeline('automatic-speech-recognition', WHISPER_ID, {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (info: { status?: string; progress?: number }) => {
      post({ id, type: 'progress', progress: info.progress ?? 0, status: info.status ?? '' })
    },
  })
  if (typeof pipe !== 'function') {
    throw new Error('Whisper pipeline did not load as a function.')
  }
  asrPipe = pipe as unknown as AsrPipe
  return asrPipe
}

async function transcribe(id: number, pcm: Float32Array): Promise<string> {
  const asr = await getAsr(id)
  const result = await asr(pcm, asrOptions(pcm.length / 16000))
  const row = Array.isArray(result) ? result[0] : result
  return (row?.text ?? '').trim()
}

function post(message: unknown) {
  parentPort?.postMessage(message)
}

// Guarded so this module can be imported in tests, where parentPort is null.
if (parentPort) {
  parentPort.on('message', (msg: { id: number; kind: 'asr' | 'warm'; pcm?: Float32Array }) => {
    void (async () => {
      try {
        if (msg.kind === 'warm') {
          await getAsr(msg.id)
          post({ id: msg.id, ok: true, result: { warm: true } })
          return
        }
        const text = await transcribe(msg.id, msg.pcm ?? new Float32Array(0))
        post({ id: msg.id, ok: true, result: { text } })
      } catch (e) {
        post({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
  })
}
```

- [ ] **Step 4: Run the worker tests to verify they pass**

Run: `npx vitest run server/voice/worker.test.ts`
Expected: PASS — 4 tests. The heavy `@huggingface/transformers` import is inside a function, so importing this module stays cheap.

- [ ] **Step 5: Write the failing client tests**

Create `server/voice/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createVoiceClient, type WorkerLike } from './client.ts'

type Sent = { id: number; kind: string; pcm?: Float32Array }

/** A worker stand-in the test drives by hand. */
function stubWorker() {
  const sent: Sent[] = []
  const listeners = {
    message: [] as ((v: unknown) => void)[],
    exit: [] as ((c: number) => void)[],
    error: [] as ((e: Error) => void)[],
  }
  const worker: WorkerLike = {
    postMessage(value: unknown) {
      sent.push(value as Sent)
    },
    on(event: string, listener: (arg: never) => void) {
      ;(listeners as Record<string, ((arg: never) => void)[]>)[event]!.push(listener)
      return worker
    },
    terminate: vi.fn(async () => 0),
  }
  return {
    worker,
    sent,
    reply: (msg: unknown) => listeners.message.forEach((l) => l(msg)),
    progress: (id: number, progress: number) =>
      listeners.message.forEach((l) => l({ id, type: 'progress', progress })),
    exit: (code: number) => listeners.exit.forEach((l) => l(code)),
  }
}

function clientWith(worker: WorkerLike) {
  let n = 0
  return createVoiceClient({ modelDir: '/tmp/x', spawn: () => (n++, worker) })
}

/**
 * Any clip at or above 1600 samples (0.1 s at 16 kHz). transcribe() rejects
 * anything shorter before it posts to the worker, so every test that expects
 * work to reach the worker must use this, not a literal like [1].
 */
const pcm = () => new Float32Array(2000)

describe('createVoiceClient', () => {
  it('starts cold', () => {
    const s = stubWorker()
    expect(clientWith(s.worker).status().asr.state).toBe('cold')
  })

  it('rejects a clip too short to be speech without troubling the worker', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    await expect(client.transcribe(new Float32Array(10))).rejects.toThrow(/almost no audio/i)
    expect(s.sent.length).toBe(0)
  })

  it('resolves a transcription by request id', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    expect(s.sent[0]!.kind).toBe('asr')
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: 'delta U equals Q minus W' } })
    await expect(pending).resolves.toBe('delta U equals Q minus W')
    expect(client.status().asr.state).toBe('ready')
  })

  it('keeps two in-flight requests from crossing wires', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const first = client.transcribe(pcm())
    const second = client.transcribe(pcm())
    const [a, b] = [s.sent[0]!.id, s.sent[1]!.id]
    expect(a).not.toBe(b)
    // resolve out of order — second first
    s.reply({ id: b, ok: false, error: 'second failed' })
    s.reply({ id: a, ok: true, result: { text: 'first' } })
    await expect(first).resolves.toBe('first')
    await expect(second).rejects.toThrow('second failed')
  })

  it('records download progress while loading', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    s.progress(s.sent[0]!.id, 43)
    expect(client.status().asr).toMatchObject({ state: 'loading', progress: 43 })
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: 'ok' } })
    await pending
  })

  it('rejects in-flight work and records an error when the worker dies', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    s.exit(1)
    await expect(pending).rejects.toThrow(/worker/i)
    expect(client.status().asr.state).toBe('error')
  })

  it('respawns after a crash so the next request is served', async () => {
    const s1 = stubWorker()
    const s2 = stubWorker()
    const workers = [s1.worker, s2.worker]
    let n = 0
    const client = createVoiceClient({ modelDir: '/tmp/x', spawn: () => workers[n++]! })
    const doomed = client.transcribe(pcm())
    s1.exit(1)
    await expect(doomed).rejects.toThrow()

    const next = client.transcribe(pcm())
    expect(s2.sent.length).toBe(1)
    s2.reply({ id: s2.sent[0]!.id, ok: true, result: { text: 'recovered' } })
    await expect(next).resolves.toBe('recovered')
  })

  it('reports an empty transcript as an error the route can surface', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: '' } })
    await expect(pending).rejects.toThrow(/silence/i)
  })
})
```

- [ ] **Step 6: Run the client tests to verify they fail**

Run: `npx vitest run server/voice/client.test.ts`
Expected: FAIL — `Failed to resolve import "./client.ts"`.

- [ ] **Step 7: Write `server/voice/client.ts`**

```ts
import { Worker } from 'node:worker_threads'
import path from 'node:path'

export type VoiceState = 'cold' | 'loading' | 'ready' | 'error'

export interface VoiceStatus {
  asr: { state: VoiceState; progress: number; error?: string }
}

export interface VoiceClient {
  transcribe(pcm: Float32Array): Promise<string>
  warm(): Promise<void>
  status(): VoiceStatus
  dispose(): Promise<void>
}

export interface WorkerLike {
  postMessage(value: unknown, transfer?: readonly ArrayBuffer[]): void
  on(event: string, listener: (arg: never) => void): unknown
  terminate(): Promise<number>
}

export type SpawnWorker = (modelDir: string) => WorkerLike

export const realSpawn: SpawnWorker = (modelDir) =>
  new Worker(path.join(import.meta.dirname, 'worker.ts'), { workerData: { modelDir } }) as unknown as WorkerLike

interface Pending {
  resolve: (value: never) => void
  reject: (err: Error) => void
}

export function createVoiceClient(opts: { modelDir: string; spawn?: SpawnWorker }): VoiceClient {
  const spawn = opts.spawn ?? realSpawn
  const pending = new Map<number, Pending>()
  const status: VoiceStatus = { asr: { state: 'cold', progress: 0 } }
  let worker: WorkerLike | null = null
  let nextId = 1
  let disposed = false

  function fail(err: Error) {
    for (const [, p] of pending) p.reject(err)
    pending.clear()
  }

  function ensure(): WorkerLike {
    if (worker) return worker
    const w = spawn(opts.modelDir)
    w.on('message', ((msg: {
      id?: number
      type?: string
      progress?: number
      ok?: boolean
      result?: { text?: string }
      error?: string
    }) => {
      if (typeof msg.id !== 'number') return
      if (msg.type === 'progress') {
        status.asr = { state: 'loading', progress: Math.round(msg.progress ?? 0) }
        return
      }
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) {
        status.asr = { state: 'ready', progress: 100 }
        p.resolve((msg.result ?? {}) as never)
      } else {
        const message = msg.error ?? 'Voice worker failed.'
        status.asr = { state: 'error', progress: 0, error: message }
        p.reject(new Error(message))
      }
    }) as never)
    w.on('exit', (() => {
      if (disposed) return
      worker = null
      status.asr = { state: 'error', progress: 0, error: 'The voice worker stopped unexpectedly.' }
      fail(new Error('The voice worker stopped unexpectedly. Try again.'))
    }) as never)
    w.on('error', ((e: Error) => {
      status.asr = { state: 'error', progress: 0, error: e.message }
      fail(e)
    }) as never)
    worker = w
    return w
  }

  function send(kind: 'asr' | 'warm', pcm?: Float32Array): Promise<{ text?: string }> {
    if (disposed) return Promise.reject(new Error('Voice client is disposed.'))
    const w = ensure()
    const id = nextId++
    if (status.asr.state === 'cold') status.asr = { state: 'loading', progress: 0 }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: never) => void, reject })
      const transfer = pcm ? [pcm.buffer] : undefined
      w.postMessage({ id, kind, pcm }, transfer)
    })
  }

  return {
    async transcribe(pcm) {
      if (pcm.length < 1600) {
        throw new Error('Whisper got almost no audio. Check the microphone and try again.')
      }
      const result = await send('asr', pcm)
      const text = (result.text ?? '').trim()
      if (!text) throw new Error('Whisper heard silence. Speak closer to the mic.')
      return text
    },
    async warm() {
      await send('warm')
    },
    status() {
      return { asr: { ...status.asr } }
    },
    async dispose() {
      disposed = true
      fail(new Error('Voice client is disposed.'))
      const w = worker
      worker = null
      if (w) await w.terminate().catch(() => undefined)
    },
  }
}
```

- [ ] **Step 8: Run the client tests to verify they pass**

Run: `npx vitest run server/voice/client.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 9: Commit**

```bash
git add server/voice/worker.ts server/voice/client.ts server/voice/worker.test.ts server/voice/client.test.ts
git commit -m "Add Whisper worker thread and main-thread client

The client correlates responses by request id, reports download progress,
and respawns the worker after a crash."
```

---

### Task 5: ASR and health routes

**Files:**
- Create: `server/routes/asr.ts`
- Create: `server/routes/health.ts`
- Test: `server/routes/asr.test.ts`
- Test: `server/routes/health.test.ts`

**Interfaces:**
- Consumes: `readBody`, `toFloat32`, `sendJson`, `sendError`, `HttpError` (Task 3); `VoiceClient` (Task 4).
- Produces: `createAsrHandler(deps: { voice: VoiceClient }): (req, res) => Promise<void>`, `createHealthHandler(deps: { voice: VoiceClient }): (req, res) => void`. Task 6 consumes both.

- [ ] **Step 1: Write the failing asr route tests**

Create `server/routes/asr.test.ts`:

```ts
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceClient, VoiceStatus } from '../voice/client.ts'
import { createAsrHandler } from './asr.ts'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

function fakeVoice(overrides: Partial<VoiceClient> = {}): VoiceClient {
  const status: VoiceStatus = { asr: { state: 'ready', progress: 100 } }
  return {
    transcribe: async () => 'delta U equals Q minus W',
    warm: async () => undefined,
    status: () => status,
    dispose: async () => undefined,
    ...overrides,
  }
}

async function serve(voice: VoiceClient) {
  const handler = createAsrHandler({ voice })
  server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((r) => server!.listen(0, r))
  const addr = server!.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return `http://127.0.0.1:${addr.port}/api/asr`
}

function pcm(samples: number[]) {
  return Buffer.from(new Float32Array(samples).buffer)
}

describe('POST /api/asr', () => {
  it('returns the transcript for valid PCM', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.1)) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ text: 'delta U equals Q minus W' })
  })

  it('reports elapsed milliseconds', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.1)) })
    expect((await res.json()).ms).toBeGreaterThanOrEqual(0)
  })

  it('rejects a body whose length is not a multiple of 4 with 400', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST', body: Buffer.alloc(7) })
    expect(res.status).toBe(400)
  })

  it('rejects an empty body with 400', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('surfaces the silence message with 422', async () => {
    const url = await serve(
      fakeVoice({
        transcribe: async () => {
          throw new Error('Whisper heard silence. Speak closer to the mic.')
        },
      }),
    )
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.001)) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/silence/i)
  })

  it('surfaces a short-recording message with 400', async () => {
    const url = await serve(
      fakeVoice({
        transcribe: async () => {
          throw new Error('Whisper got almost no audio. Check the microphone and try again.')
        },
      }),
    )
    const res = await fetch(url, { method: 'POST', body: pcm([0, 0, 0, 0]) })
    expect(res.status).toBe(400)
  })

  it('returns 503 while the model is unavailable', async () => {
    const url = await serve(
      fakeVoice({
        transcribe: async () => {
          throw new Error('the voice worker stopped unexpectedly')
        },
      }),
    )
    const res = await fetch(url, { method: 'POST', body: pcm(new Array(2000).fill(0.1)) })
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/routes/asr.test.ts`
Expected: FAIL — `Failed to resolve import "./asr.ts"`.

- [ ] **Step 3: Write `server/routes/asr.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError, readBody, sendError, sendJson, toFloat32 } from '../http.ts'
import type { VoiceClient } from '../voice/client.ts'

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
      const pcm = toFloat32(await readBody(req))
      const text = await deps.voice.transcribe(pcm)
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
```

- [ ] **Step 4: Run to verify the asr tests pass**

Run: `npx vitest run server/routes/asr.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Write the failing health route test**

Create `server/routes/health.test.ts`:

```ts
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceClient } from '../voice/client.ts'
import { createHealthHandler } from './health.ts'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

async function readHealth(voice: VoiceClient) {
  const handler = createHealthHandler({ voice })
  server = createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server!.listen(0, r))
  const addr = server!.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`)
  return { status: res.status, body: (await res.json()) as { asr: { state: string } } }
}

describe('GET /api/health', () => {
  it('reports the worker state', async () => {
    const voice: VoiceClient = {
      transcribe: async () => '',
      warm: async () => undefined,
      status: () => ({ asr: { state: 'cold', progress: 0 } }),
      dispose: async () => undefined,
    }
    const { status, body } = await readHealth(voice)
    expect(status).toBe(200)
    expect(body.asr).toMatchObject({ state: 'cold', progress: 0 })
  })

  it('is 200 even when the worker is in error, so the UI can render the reason', async () => {
    const voice: VoiceClient = {
      transcribe: async () => '',
      warm: async () => undefined,
      status: () => ({ asr: { state: 'error', progress: 0, error: 'boom' } }),
      dispose: async () => undefined,
    }
    const { status, body } = await readHealth(voice)
    expect(status).toBe(200)
    expect(body.asr).toMatchObject({ state: 'error' })
  })
})
```

- [ ] **Step 6: Write `server/routes/health.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from '../http.ts'
import type { VoiceClient } from '../voice/client.ts'

export function createHealthHandler(deps: { voice: VoiceClient }) {
  return function handleHealth(_req: IncomingMessage, res: ServerResponse) {
    sendJson(res, 200, { ok: true, asr: deps.voice.status().asr })
  }
}
```

- [ ] **Step 7: Run all server tests**

Run: `npx vitest run server`
Expected: PASS — every server test.

- [ ] **Step 8: Commit**

```bash
git add server/routes/
git commit -m "Add ASR and health routes with failure-classified status codes"
```

---

### Task 6: Server entry point and scripts

**Files:**
- Modify: `server/main.ts` (create)
- Modify: `package.json`
- Test: manual, then verified by Task 9

**Interfaces:**
- Consumes: `readConfig` (Task 2), `createVoiceClient` and `realSpawn` (Task 4), both route factories (Task 5).
- Produces: a running server. Task 7 consumes the HTTP surface.

- [ ] **Step 1: (superseded — do not implement) Simplest shape of `server/main.ts`**

**Skip this step.** Step 2 replaces this file in full; this is only the minimal shape, kept so the
entry point's responsibilities are visible before the Vite-aware version lands. Implement Step 2's
version instead.

```ts
import { createServer } from 'node:http'
import { readConfig } from './env.ts'
import { requestPathname } from './http.ts'
import { createAsrHandler } from './routes/asr.ts'
import { createHealthHandler } from './routes/health.ts'
import { createVoiceClient, realSpawn } from './voice/client.ts'

const config = readConfig()
const voice = createVoiceClient({ modelDir: config.modelDir, spawn: realSpawn })

const handleAsr = createAsrHandler({ voice })
const handleHealth = createHealthHandler({ voice })

const server = createServer((req, res) => {
  const pathname = requestPathname(req)

  if (pathname === '/api/health') return handleHealth(req, res)
  if (pathname === '/api/asr' && req.method === 'POST') return void handleAsr(req, res)

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(config.port, () => {
  console.log(`[sabi] listening on http://localhost:${config.port}`)
  console.log(`[sabi] models cache: ${config.modelDir}`)
})

async function shutdown() {
  await voice.dispose()
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
```

- [ ] **Step 2: Make the server own the port in production only, Vite in development**

Replace the whole of `server/main.ts` from Step 1 with the Vite-aware version. In development Vite creates the HTTP server and this file plugs routes into it; in production this file serves `dist/` itself.

```ts
import fs from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { readConfig } from './env.ts'
import { requestPathname } from './http.ts'
import { createAsrHandler } from './routes/asr.ts'
import { createHealthHandler } from './routes/health.ts'
import { createVoiceClient, realSpawn } from './voice/client.ts'

const config = readConfig()
const voice = createVoiceClient({ modelDir: config.modelDir, spawn: realSpawn })

const handleAsr = createAsrHandler({ voice })
const handleHealth = createHealthHandler({ voice })

function routes(req: IncomingMessage, res: ServerResponse): boolean {
  const pathname = requestPathname(req)
  if (pathname === '/api/health') {
    handleHealth(req, res)
    return true
  }
  if (pathname === '/api/asr' && req.method === 'POST') {
    void handleAsr(req, res)
    return true
  }
  return false
}

async function main() {
  if (config.production) {
    const dist = path.join(process.cwd(), 'dist')
    if (!fs.existsSync(dist)) {
      throw new Error(`No production bundle at ${dist}. Run "npm run build" first.`)
    }
    const serveStatic = await import('./static.ts')
    createServer((req, res) => {
      if (routes(req, res)) return
      serveStatic.serveFrom(dist, req, res)
    }).listen(config.port, announce)
    return
  }

  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  const server = createServer((req, res) => {
    if (routes(req, res)) return
    vite.middlewares(req, res)
  })
  server.listen(config.port, announce)
}

function announce() {
  console.log(`[sabi] listening on http://localhost:${config.port}`)
  console.log(`[sabi] models cache: ${config.modelDir}`)
}

async function shutdown() {
  await voice.dispose()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

main().catch((e: unknown) => {
  console.error('[sabi] failed to start:', e instanceof Error ? e.message : e)
  process.exit(1)
})
```

- [ ] **Step 3: Add `requestPathname` to `server/http.ts`, then write `server/static.ts`**

Append this export to `server/http.ts` (the file from Task 3 — this is the only change to it):

```ts
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
```

Then create `server/static.ts`:

```ts
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
```

- [ ] **Step 4: Update the scripts**

In `package.json`, replace the `"scripts"` block:

```json
"scripts": {
  "dev": "node --env-file-if-exists=.env server/main.ts",
  "build": "tsc -b && vite build",
  "start": "NODE_ENV=production node --env-file-if-exists=.env server/main.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "oxlint"
}
```

`preview` is removed — `start` supersedes it. Note it currently carries the `/v1beta` proxy that Phase 2 deletes; the `vite.config.ts` `preview` block can stay until then without harm.

- [ ] **Step 5: Verify the server boots**

Run: `npm run dev`
Expected: `[sabi] listening on http://localhost:5173` and `[sabi] models cache: .../server/.models`. Open the URL — the Studio must render exactly as before, since nothing in `src/` has changed yet.

- [ ] **Step 6: Verify the API by hand**

In a second terminal:

```bash
curl -s http://localhost:5173/api/health
```

Expected: `{"ok":true,"asr":{"state":"cold","progress":0}}`.

```bash
curl -s -X POST http://localhost:5173/api/asr --data-binary @/dev/null -H 'Content-Type: application/octet-stream'
```

Expected: `{"error":"Empty audio body."}` with status 400.

```bash
curl -s -H 'Host: a b' http://127.0.0.1:5173/api/health >/dev/null; curl -s http://localhost:5173/api/health
```

Expected: the second call still returns `{"ok":true,"asr":{"state":"cold","progress":0}}`. A malformed
`Host` header must not take the server down — before `requestPathname` it did, because the `TypeError`
from `new URL` escaped the request listener as an uncaught exception.

- [ ] **Step 7: Commit**

```bash
git add server/main.ts server/static.ts server/http.ts package.json
git commit -m "Add server entry point hosting Vite in middleware mode

npm run dev now starts frontend and backend as one process on one port."
```

---

### Task 7: Frontend API helpers

**Files:**
- Create: `src/lib/api.ts`
- Test: `src/lib/api.test.ts`

**Interfaces:**
- Consumes: the HTTP surface from Task 6.
- Produces: `interface AsrStatus { state: 'cold' | 'loading' | 'ready' | 'error'; progress: number; error?: string }`, `getHealth(): Promise<{ asr: AsrStatus }>`, `postAsr(pcm: Float32Array): Promise<string>`, `describeAsrProgress(status: AsrStatus | null): string | null`. Task 8 consumes all of these.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeAsrProgress, getHealth, postAsr } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Any clip at or above 1600 samples (0.1 s at 16 kHz). `postAsr` rejects
 * anything shorter before it reaches `fetch`, so every case that expects a
 * request to go out must use this, not a literal like `[0.1, 0.2, 0.3]`.
 */
const pcm = () => new Float32Array(2000)

describe('postAsr', () => {
  it('POSTs raw PCM and returns the transcript', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: 'delta U equals Q minus W' }))
    vi.stubGlobal('fetch', fetchMock)

    const sent = pcm()
    const text = await postAsr(sent)

    expect(text).toBe('delta U equals Q minus W')
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('/api/asr')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/octet-stream',
    )
    // Identity, not merely presence: `postAsr` must hand `fetch` the very view it
    // was given. Switching to `pcm.buffer` would send the whole backing buffer
    // for a subarray, and without this assertion that regression is invisible —
    // deleting `body:` entirely would also pass.
    expect(init.body).toBe(sent)
  })

  it('throws the server error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Whisper heard silence.' }, 422)))
    await expect(postAsr(pcm())).rejects.toThrow('Whisper heard silence.')
  })

  it('throws a readable message when the body is not JSON', async () => {
    // The fixture deliberately contains no digits. Node's `res.json()` error for
    // non-JSON text quotes the offending body, so a fixture reading
    // `<html>502</html>` would satisfy a `/502/` assertion straight from that
    // SyntaxError — the fallback this test exists to cover could be deleted
    // outright and the test would still pass. Asserting the exact fallback
    // message is what makes it discriminate.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })),
    )
    await expect(postAsr(pcm())).rejects.toThrow('Request failed with status 502.')
  })

  it('refuses to send a clip too short to transcribe', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(postAsr(new Float32Array(10))).rejects.toThrow(/too short/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports silence when the server returns blank text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ text: '   ' })))
    await expect(postAsr(pcm())).rejects.toThrow('Whisper heard silence. Speak closer to the mic.')
  })
})

describe('getHealth', () => {
  it('returns the ASR status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ asr: { state: 'ready', progress: 100 } })))
    expect(await getHealth()).toMatchObject({ asr: { state: 'ready' } })
  })

  it('throws the server error message when health is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Backend is down.' }, 503)))
    await expect(getHealth()).rejects.toThrow('Backend is down.')
  })
})

describe('describeAsrProgress', () => {
  it('is silent when the model is ready', () => {
    expect(describeAsrProgress({ state: 'ready', progress: 100 })).toBeNull()
  })

  it('is silent when cold, so the UI shows nothing before first use', () => {
    expect(describeAsrProgress({ state: 'cold', progress: 0 })).toBeNull()
  })

  it('reports download progress', () => {
    expect(describeAsrProgress({ state: 'loading', progress: 43 })).toBe('Whisper small · 43%')
  })

  it('reports the error text when the worker failed', () => {
    expect(describeAsrProgress({ state: 'error', progress: 0, error: 'boom' })).toBe('boom')
  })

  it('tolerates a null status', () => {
    expect(describeAsrProgress(null)).toBeNull()
  })

  it('falls back to a generic message when an error carries no text', () => {
    expect(describeAsrProgress({ state: 'error', progress: 0 })).toBe('Voice backend error.')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/api.test.ts`
Expected: FAIL — the suite cannot load `./api`, because the module does not exist yet. The reporter's
wording varies (`Failed to resolve import "./api"`, `Cannot find module './api'`, `Failed to load url
./api`); any of them is the failure this step asks for.

- [ ] **Step 3: Write `src/lib/api.ts`**

```ts
export interface AsrStatus {
  state: 'cold' | 'loading' | 'ready' | 'error'
  progress: number
  error?: string
}

export interface Health {
  ok: boolean
  asr: AsrStatus
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
export async function postAsr(pcm: Float32Array): Promise<string> {
  if (pcm.length < 1600) {
    throw new Error('Recording too short. Hold the mic and speak a full sentence.')
  }
  const res = await fetch('/api/asr', {
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
export function describeAsrProgress(status: AsrStatus | null): string | null {
  if (!status) return null
  if (status.state === 'error') return status.error ?? 'Voice backend error.'
  if (status.state === 'loading') return `Whisper small · ${Math.round(status.progress)}%`
  return null
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/api.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "Add typed frontend helpers for the ASR and health endpoints"
```

---

### Task 8: Switch the Studio to backend ASR

**Files:**
- Modify: `src/lib/voice/whisper.ts`
- Modify: `src/pages/Studio.tsx`
- Modify: `src/components/studio/settings-drawer.tsx`

**Interfaces:**
- Consumes: `blobToMono16k` (Task 1), `postAsr`/`getHealth`/`describeAsrProgress` (Task 7).
- Produces: `transcribeWithWhisper({ audio }): Promise<string>` keeps its name and call signature so `Studio.tsx` changes minimally, but now takes only `audio`. `whisperReady()` and `loadWhisperSmall()` are **removed** — the drawer's call site is updated in this task.

- [ ] **Step 1: Rewrite `src/lib/voice/whisper.ts`**

The whole file becomes a thin adapter. All model loading is gone.

```ts
import { postAsr } from '@/lib/api'
import { blobToMono16k } from './pcm'

/**
 * Browser-side half of speech recognition.
 *
 * The model itself runs in the Sabi backend (server/voice/worker.ts). This
 * module only decodes the recording to 16 kHz mono PCM — work the browser does
 * natively — and posts it. Keeping the decode here is why the backend needs no
 * WebM/Opus decoder and no ffmpeg dependency.
 */
export async function transcribeWithWhisper(opts: { audio: Blob }): Promise<string> {
  const { audio } = opts
  if (!audio || audio.size < 800) {
    throw new Error('Recording too short. Hold the mic and speak a full sentence.')
  }
  const pcm = await blobToMono16k(audio)
  return postAsr(pcm)
}
```

- [ ] **Step 2: Update `Studio.tsx`**

Replace the `whisperNote` state and its progress callback. Delete this line from the imports (currently line 18):

```ts
import { transcribeWithWhisper } from '@/lib/voice/whisper'
```

and replace with:

```ts
import { transcribeWithWhisper } from '@/lib/voice/whisper'
import { describeAsrProgress, getHealth, type AsrStatus } from '@/lib/api'
```

Replace `const [whisperNote, setWhisperNote] = useState<string | null>(null)` with:

```ts
const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null)
const whisperNote = describeAsrProgress(asrStatus)
```

Add a poll that runs only while a model download is in progress. Place it after the existing `useEffect` that opens the harness:

```ts
useEffect(() => {
  if (asrStatus?.state !== 'loading') return
  const timer = window.setInterval(() => {
    getHealth()
      .then((h) => setAsrStatus(h.asr))
      .catch(() => undefined)
  }, 1000)
  return () => window.clearInterval(timer)
}, [asrStatus?.state])
```

Replace the body of the `try` block in `stopMic` (`Studio.tsx:206-226`). It currently reads:

```ts
const text = await transcribeWithWhisper({
  audio: blob,
  course: settings.courseName,
  notation: settings.notation,
  accent: settings.accent,
  onProgress: (p) => {
    if (p.status === 'progress' && p.file) {
      setWhisperNote(`Whisper small · ${Math.round(p.progress ?? 0)}%`)
    } else if (p.status === 'ready') {
      setWhisperNote(null)
    }
  },
})
setWhisperNote(null)
await ask(text)
```

and becomes:

```ts
setAsrStatus({ state: 'loading', progress: 0 })
const text = await transcribeWithWhisper({ audio: blob })
setAsrStatus({ state: 'ready', progress: 100 })
await ask(text)
```

Then **add** `setAsrStatus(null)` to the `catch` of `stopMic`. The catch currently sets only `setErr`, `setState`, and `setTyping` — there is no `setWhisperNote(null)` line there to replace, so add the new line rather than substituting for one. It matters: without it a failed transcription leaves `asrStatus` at `{ state: 'loading', progress: 0 }`, so the orb keeps a stale `Whisper small · 0%` line and the 1 Hz health poll above never stops, because nothing moves the state off `'loading'`.

- [ ] **Step 3: Update the settings drawer**

In `src/components/studio/settings-drawer.tsx`, delete the import on line 7:

```ts
import { loadWhisperSmall, whisperReady } from '@/lib/voice/whisper'
```

Replace the whole "Listening · Whisper small" section (the `<section>` beginning at line 84 with `<p ...>Listening · Whisper small</p>`) with a read-only status panel. It no longer preloads, because the model no longer lives in the browser:

```tsx
<section className="mt-8 grid gap-3">
  <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Listening · Whisper small</p>
  <p className="text-[12px] text-muted">
    Student speech is transcribed with Whisper small by the Sabi backend on this machine — not
    Gemini, and not your browser. The first recording downloads the model once to
    <code className="mx-1">server/.models/</code>.
  </p>
  <Button
    type="button"
    variant="outline"
    disabled={busy}
    onClick={async () => {
      setBusy(true)
      try {
        const health = await getHealth()
        const state = health.asr.state
        toast(
          state === 'ready'
            ? 'Whisper small ready'
            : state === 'loading'
              ? `Loading… ${Math.round(health.asr.progress)}%`
              : state === 'error'
                ? (health.asr.error ?? 'Voice backend error')
                : 'Backend is up. Model loads on first use.',
        )
      } catch (e) {
        toast(explainError(e))
      } finally {
        setBusy(false)
      }
    }}
  >
    {busy ? 'Checking…' : 'Check voice backend'}
  </Button>
</section>
```

Add the import at the top:

```ts
import { getHealth } from '@/lib/api'
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc -b && npm run lint`
Expected: both exit 0.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, then in the Studio tap the mic, speak for ~3 seconds, tap stop.

Expected:
- The network tab shows a `POST /api/asr` returning 200.
- **No request to `huggingface.co` or `cdn-lfs` from the browser.**
- `server/.models/` fills with Whisper files on the first run; the console prints download progress.
- The transcript appears and the tutor replies.
- A second recording is fast — no download.

- [ ] **Step 6: Commit**

```bash
git add src/lib/voice/whisper.ts src/pages/Studio.tsx src/components/studio/settings-drawer.tsx
git commit -m "Point the Studio at the backend transcriber

The browser now only decodes and resamples; the model runs server-side."
```

---

### Task 9: Delete the dead voice stack and update the docs

**Files:**
- Delete: the nine files listed below
- Modify: `src/lib/voice/types.ts`
- Modify: `README.md`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a self-consistent repository.

- [ ] **Step 1: Confirm every file to delete is still unreferenced**

Run:

```bash
doomed='^src/lib/voice/(providers/|(asr|tts|controller)\.ts:)|^src/lib/gemini/asr\.ts:|^src/components/assessment/voice-answer\.tsx:'
grep -rnE "['\"][^'\"]*(voice/providers/|lib/voice/(asr|tts|controller)|lib/gemini/asr|\./(asr|tts|controller|providers/)|voice-answer)[^'\"]*['\"]" \
  src --include='*.ts' --include='*.tsx' \
  | grep -vE "$doomed" || echo "no surviving references"
```

Expected: `no surviving references`. The check greps import specifiers rather than bare basenames, and
excludes all nine files rather than only the one under test, so a printed line is a genuine survivor —
read it before deleting. Do not weaken it to a basename match: a basename over-matches, and an
extension-stripping mistake on the base name under-matches, and either way the check stops being able
to fail — which is worse than having no check at all, because it is trusted.

- [ ] **Step 2: Delete them**

```bash
git rm src/lib/voice/providers/whisper.ts \
       src/lib/voice/providers/demo-asr.ts \
       src/lib/voice/providers/web-speech-tts.ts \
       src/lib/voice/providers/custom-tts.ts \
       src/lib/voice/asr.ts \
       src/lib/voice/tts.ts \
       src/lib/voice/controller.ts \
       src/lib/gemini/asr.ts \
       src/components/assessment/voice-answer.tsx
rmdir src/lib/voice/providers 2>/dev/null || true
```

- [ ] **Step 3: Prune the orphaned types**

In `src/lib/voice/types.ts`, delete `AsrProviderId`, `TtsProviderId`, `AsrOptions`, `AsrResult`, `AsrProvider`, `SpeechPlan`, and `TtsProvider`. Keep `VoiceState` and `voiceStateCopy` — `Studio.tsx` uses both.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b && npm run lint && npx vitest run`
Expected: all exit 0. A failure here means something still referenced the deleted stack.

- [ ] **Step 5: Update `DESIGN.md`**

Locate the paragraph by its content — it is the one beginning `Whisper: **not downloaded**`. (This step
originally said "line 7"; line 7 is blank and the paragraph is on line 8, so match the text rather than
counting lines.) Replace it:

```
Whisper: **not downloaded**. ASR is an interface with a Whisper provider stub. Runtime uses MediaRecorder + a demo transcript path. TTS is a separate controller.
```

with:

```
Whisper: **runs in the backend**, not the browser. The client decodes a recording to 16 kHz mono PCM and posts it to `/api/asr`; `server/voice/worker.ts` runs `Xenova/whisper-small` on a worker thread with weights cached in `server/.models/`. TTS is unchanged — still the browser's `speechSynthesis`.
```

Then correct the three places further down the same file that the paragraph above now contradicts. A
document that says Whisper runs in the backend while its own architecture section says Whisper is not
installed is self-inconsistent, which is the thing this task exists to remove. Apply each change to the
text exactly as given:

1. The bullet `4. Whisper: listed as ASR provider, not loaded.` becomes:

```
4. Whisper: transcribed by the backend on this machine, on a worker thread.
```

2. The heading `## Voice architecture (Whisper not installed)` becomes:

```
## Voice architecture (Whisper runs in the backend)
```

3. In the diagram under that heading, replace these three lines:

```
mic → MediaRecorder → AsrProvider.transcribe()
                         ├─ whisper  (stub — do not download)
                         └─ demo     (local, for UI)
```

with:

```
mic → MediaRecorder → decode to 16 kHz mono PCM → POST /api/asr
                         └─ server/voice/worker.ts → Xenova/whisper-small
```

Leave the rest of that diagram alone — its TTS half still describes the browser `speechSynthesis` path,
which is accurate until Phase 2. Also leave the landing-page note `6. Perf: no three.js, no Whisper.`
as it stands: it is about what the landing route bundles, and the landing route still loads neither.

- [ ] **Step 6: Update `README.md`**

In §3, replace the "Listening — Whisper small" subsection. The browser-cache instruction is now wrong. New text:

```markdown
### Listening — Whisper small

Speech recognition runs in the Sabi backend on your own machine, not in the browser and not at
Google. The browser only decodes your recording and posts it.

1. Tap the mic and talk. The first recording downloads **Xenova/whisper-small** (~250 MB) to
   `server/.models/` — once. Progress shows under the orb as `Whisper small · N%`.
2. Allow the microphone when the browser asks.
3. Tap again to stop. Whisper transcribes; Gemini only ever sees the text.

Check the backend any time from gear → *Listening · Whisper small* → **Check voice backend**.

Calibrated for English lecture speech (16 kHz mono, English).

If Whisper fails: type instead. The keyboard icon still works.
```

While you are in §3, one stale claim survives in the "Speaking — accent and custom voice" subsection
just below, at the line beginning `1. **Accent** —` and ending `and Whisper's hint.` The accent no
longer reaches Whisper: the client posts only PCM (`postAsr(pcm)`) and the worker fixes
`{ language: 'english', task: 'transcribe' }`, so the request carries no hint parameter and none of
`AsrOptions` survives to carry one. Delete the words ` and Whisper's hint`, leaving
`This sets the speech language (`en-NG`, `en-GB`, …).` — the sentence is otherwise true, because the
accent does still set the `speechSynthesis` language.

The size figure is **~250 MB**, not the ~500 MB this step first said. The worker loads with
`dtype: 'q8'` (`server/voice/worker.ts:48`), which resolves to the repo's `*_quantized.onnx` files:
`encoder_model_quantized.onnx` is 92.3 MB and `decoder_model_merged_quantized.onnx` is 157 MB, so the
download is ~249 MB plus tokenizer and config. The old ~500 MB figure was carried over from the
browser-cache era without being re-measured, and overstated by roughly 2×. Do not "restore" it — the
per-file sizes come from the `Xenova/whisper-small` repository listing.

In §5, replace the storage table row `| Whisper weights | Browser cache (Hugging Face / transformers.js) |` with:

```markdown
| Whisper weights | `server/.models/` on this machine (never the browser) |
```

And replace the reset paragraph that says clearing site data wipes "the Whisper download" — clearing site data no longer touches the model. New text:

```markdown
Clearing site data for `localhost` wipes the key, notes, and settings. It does not touch the
Whisper weights, which live in `server/.models/` — delete that directory to force a re-download.
```

Finally, in the unnumbered `## Commands` section near the end of the README, the line
`npm run preview  # serve the bundle` is now stale — `preview` no longer exists, because Task 6
replaced it with `start`. Replace that one line with `npm start        # serve the built bundle`,
keeping the column alignment of its three neighbours and leaving them untouched.

One more entry in the same file is stale for the same reason. Under `## 6. If something breaks`, this
troubleshooting block:

```markdown
**Whisper stuck on 0%**  
Needs network the first time. Ad-blockers can block `huggingface.co`. Allow it, or use **Preload Whisper small** on Wi‑Fi.
```

names a button this phase deleted — Task 8 replaced **Preload Whisper small** with **Check voice
backend** — and a failure mode that no longer exists: the download left the browser, and an ad-blocker
running in the page cannot stop a fetch made by the Node process.

The replacement below also corrects a claim this plan itself first got backwards, which is why the
steps above said "Watch the terminal for progress". That is inverted. `server/main.ts` logs only two
startup lines (`:56-57`) and nothing else, at any point; the worker's `progress` messages instead travel
`server/voice/worker.ts` → `server/voice/client.ts` (stored on `status.asr`) → `GET /api/health` → the
Studio's 1 Hz poll, and render as the `Whisper small · N%` line under the orb (`describeAsrProgress` in
`src/lib/api.ts`, shown at `src/pages/Studio.tsx:347-348`). Progress is visible **in the browser**, not
in the terminal. Sending a stuck user to watch an empty terminal — while dismissing the one on-screen
indicator that would actually tell them something — is the same class of error this task exists to
remove, so the copy below names the Studio, not the terminal. Replace both lines with:

```markdown
**Whisper stuck on 0%**  
The first recording downloads the model into `server/.models/`. Progress appears under the orb in the Studio as `Whisper small · N%` — the backend reports it over `/api/health`, so the terminal prints nothing. If the number never moves, check that machine's network, then gear → *Listening · Whisper small* → **Check voice backend**.
```

The first line of that block ends with **two trailing spaces** — that is Markdown's hard line break, and
every neighbouring entry in the section uses it. Keep them, even though they are invisible.

- [ ] **Step 7: Verify the browser is lighter**

Run `npm run dev`, open the Studio, and in DevTools check **Memory** and the **Application → Cache Storage** panel.

Expected: no ONNX/WASM runtime in the page heap, no Whisper entries in the browser cache, and the tab stays responsive while a transcription runs.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Delete the dead voice provider stack and correct the docs

DESIGN.md claimed Whisper was never downloaded while whisper.ts downloaded
it. Both are now replaced by one accurate story: the model runs in the
backend."
```

---

## Phase 1 completion

Phase 1 is done when all of the following hold:

- `npm run dev` starts one process on `:5173` serving both the app and `/api/*`.
- No browser request reaches `huggingface.co`.
- `server/.models/` holds the Whisper weights.
- The Studio's memory profile carries no ONNX runtime.
- Speaking into the mic produces a transcript and a tutor reply.
- Killing the worker process and retrying recovers.
- `npx tsc -b`, `npm run lint`, and `npx vitest run` all pass.

Phase 2 (`docs/superpowers/plans/2026-10-08-voice-backend-phase-2.md`) covers Kokoro TTS and the
Gemini corrections.

