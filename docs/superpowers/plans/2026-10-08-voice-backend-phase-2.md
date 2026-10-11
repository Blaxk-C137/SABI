# Voice Backend — Phase 2: Kokoro TTS and Gemini Corrections

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tutor a real local voice through backend Kokoro, move the Gemini key server-side, and correct the model configuration so a fresh API key works.

**Architecture:** The Phase 1 worker and client gain a second model. `/api/tts` returns WAV; `/api/tutor` becomes the only path to Google and holds the key. The frontend's Gemini client shrinks to a POST against `/api/tutor` plus an SSE reader, and the browser's Web Speech synthesis is replaced by `<audio>` playback whose waveform drives the orb.

**Tech Stack:** Phase 1 stack plus `phonemizer` (Kokoro's phonemiser) and `onnx-community/Kokoro-82M-v1.0-ONNX`.

**Spec:** `docs/superpowers/specs/2026-10-08-voice-backend-design.md`

**Depends on:** `docs/superpowers/plans/2026-10-08-voice-backend-phase-1.md` — all of it, merged and passing.

## Global Constraints

Inherited from Phase 1, unchanged:

- Node 24.12+; server files run under native type stripping — **no build step**.
- `erasableSyntaxOnly: true` — **no enums, no parameter properties, no namespaces**.
- `verbatimModuleSyntax: true` — **use `import type`**.
- Server ESM imports **must carry explicit `.ts` extensions**.
- The server tree must never import from `src/`.
- No new runtime dependency other than `phonemizer`.

Phase 2 additions:

- **The Gemini API key must never reach the browser.** It is read from `process.env.GEMINI_API_KEY` and appears in no response body, no log line, and no client bundle.
- **The server is the single source of truth for the model list.** The settings dropdown is populated from `/api/health`; a second hard-coded list in `src/` is a defect, not a convenience.
- Kokoro has no Nigerian, Ghanaian, or Indian English voice. `en-NG`, `en-GH`, and `en-IN` map to a British voice **and the UI must say so.**

## Review Focus

Failure modes the spec implies but that no happy-path test exercises. Each is pinned by a test in the task named.

1. **Gemini returns a mid-stream error** (quota exhausted on turn two). The client must surface a message, not hang on a half-finished reply. → Task 5.
2. **A reply whose spoken form is empty** — a turn that is only a `<board>` or only LaTeX. The client must skip the TTS round trip entirely, not POST an empty string. → Task 7.
3. **The key is absent but the server is running.** The UI must explain it rather than showing an unexplained failure. → Task 5, Task 9.
4. **An SSE frame split across two network reads.** Pinned behaviour, carried from the existing `client.ts`. → Task 4.
5. **A very long tutor reply** (a full derivation). TTS must not block the reply from rendering, and playback must be cancellable mid-sentence. → Task 7.

---

### Task 1: WAV encoding

Pure, and easy to get wrong in a way that produces audio which is *almost* right — a wrong byte offset gives static or a chipmunk voice rather than silence, so it can pass a casual listen.

**Files:**
- Create: `server/voice/wav.ts`
- Test: `server/voice/wav.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `KOKORO_RATE = 24000`, `encodeWav(pcm: Float32Array, sampleRate: number): Buffer`. Task 3 consumes both.

- [ ] **Step 1: Write the failing tests**

Create `server/voice/wav.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KOKORO_RATE, encodeWav } from './wav.ts'

describe('encodeWav', () => {
  it('writes a 44-byte RIFF header before the samples', () => {
    const wav = encodeWav(new Float32Array([0, 0]), KOKORO_RATE)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ')
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data')
  })

  it('declares the total size as 36 + data size', () => {
    const wav = encodeWav(new Float32Array(100), KOKORO_RATE)
    expect(wav.readUInt32LE(4)).toBe(36 + 200)
  })

  it('declares PCM, mono, 16-bit', () => {
    const wav = encodeWav(new Float32Array([0]), KOKORO_RATE)
    expect(wav.readUInt16LE(20)).toBe(1)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt16LE(34)).toBe(16)
  })

  it('declares the sample rate and its derived byte rate', () => {
    const wav = encodeWav(new Float32Array([0]), 24000)
    expect(wav.readUInt32LE(24)).toBe(24000)
    expect(wav.readUInt32LE(28)).toBe(24000 * 2) // rate * channels * bytes
    expect(wav.readUInt16LE(32)).toBe(2) // block align
  })

  it('sizes the buffer exactly', () => {
    const wav = encodeWav(new Float32Array(1000), KOKORO_RATE)
    expect(wav.length).toBe(44 + 2000)
    expect(wav.readUInt32LE(40)).toBe(2000)
  })

  it('maps full-scale floats to the 16-bit extremes', () => {
    const wav = encodeWav(new Float32Array([1, -1, 0]), KOKORO_RATE)
    expect(wav.readInt16LE(44)).toBe(32767)
    expect(wav.readInt16LE(46)).toBe(-32767)
    expect(wav.readInt16LE(48)).toBe(0)
  })

  it('clamps out-of-range samples instead of wrapping', () => {
    const wav = encodeWav(new Float32Array([2.5, -3]), KOKORO_RATE)
    expect(wav.readInt16LE(44)).toBe(32767)
    expect(wav.readInt16LE(46)).toBe(-32767)
  })

  it('encodes silence as zeroes', () => {
    const wav = encodeWav(new Float32Array(4), 16000)
    expect(Array.from(wav.subarray(44))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/voice/wav.test.ts`
Expected: FAIL — `Failed to resolve import "./wav.ts"`.

- [ ] **Step 3: Write `server/voice/wav.ts`**

```ts
export const KOKORO_RATE = 24000

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const CHANNELS = 1
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8

/**
 * Wrap Float32 mono samples in a 16-bit PCM WAV container.
 *
 * Hand-rolled rather than pulling a dependency: it is 44 bytes of specified
 * layout and the offsets are pinned by tests.
 */
export function encodeWav(pcm: Float32Array, sampleRate: number): Buffer {
  const dataSize = pcm.length * BYTES_PER_SAMPLE
  const buf = Buffer.alloc(HEADER_BYTES + dataSize)
  const byteRate = sampleRate * CHANNELS * BYTES_PER_SAMPLE

  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // PCM fmt chunk size
  buf.writeUInt16LE(1, 20) // format: 1 = PCM
  buf.writeUInt16LE(CHANNELS, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32) // block align
  buf.writeUInt16LE(BITS_PER_SAMPLE, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]!))
    buf.writeInt16LE(Math.round(clamped * 32767), HEADER_BYTES + i * BYTES_PER_SAMPLE)
  }

  return buf
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run server/voice/wav.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/voice/wav.ts server/voice/wav.test.ts
git commit -m "Add 16-bit PCM WAV encoder for TTS output"
```

---

### Task 2: Kokoro in the worker

**Files:**
- Modify: `server/voice/worker.ts`
- Test: `server/voice/kokoro.test.ts`
- Create: `server/voice/voices.ts`

**Interfaces:**
- Consumes: the Phase 1 worker structure.
- Produces: `KOKORO_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'`, `KOKORO_VOICES`, `voiceForAccent(accent: string): string`, `ttsOptions(voice: string, speed: number): Record<string, unknown>` in `voices.ts`; the worker gains message kind `'tts'` returning `{ pcm: Float32Array, sampleRate: number }`. Tasks 3 and 8 consume `voiceForAccent` and `KOKORO_VOICES`.

- [ ] **Step 1: Install the phonemiser, then verify the Kokoro pipeline's output shape**

Kokoro does not take text directly — it takes phonemes, and transformers.js delegates that to `phonemizer`, which is an optional peer of the package and therefore not installed yet. Without it the pipeline throws at construction. This is the only new runtime dependency in either phase.

```bash
npm install phonemizer
```

The pipeline's return shape is not asserted anywhere in this repo. Confirm it rather than assuming. Create a scratch file **outside the repo** (writing it into `src/` or `server/` would break `tsc -b`):

```bash
cat > /tmp/kokoro-probe.mjs <<'EOF'
import { pipeline, env } from '@huggingface/transformers'
env.cacheDir = process.argv[2]
const tts = await pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8', device: 'cpu',
})
const out = await tts('Delta U equals Q minus W.', { voice: 'bf_emma' })
console.log('keys:', Object.keys(out))
console.log('sampling_rate:', out.sampling_rate)
console.log('audio:', out.audio?.constructor?.name, out.audio?.length)
EOF
node /tmp/kokoro-probe.mjs "$PWD/server/.models"
```

Expected: a ~330 MB download, then `sampling_rate: 24000` and `audio: Float32Array <n>`.

**If `sampling_rate` is not 24000, or the field is named differently, or `speed` is rejected — stop and correct `KOKORO_RATE` in `server/voice/wav.ts` and the mapping in Step 5 before continuing.** Record what `speed` does: if the pipeline ignores it, say so in a comment and leave `ttsOptions` clamping only, rather than shipping a control that silently does nothing. The download is cached for every later step.

- [ ] **Step 2: Write the failing voice-map tests**

Create `server/voice/kokoro.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KOKORO_ID, KOKORO_VOICES, ttsOptions } from './worker.ts'
import { voiceForAccent } from './voices.ts'

describe('voiceForAccent', () => {
  it('gives American English an American voice', () => {
    expect(voiceForAccent('en-US')).toBe('af_heart')
  })

  it('gives British English a British voice', () => {
    expect(voiceForAccent('en-GB')).toBe('bf_emma')
  })

  it('maps Nigerian English to the closest British voice', () => {
    expect(voiceForAccent('en-NG')).toBe('bf_emma')
  })

  it('maps Ghanaian and Indian English to the closest British voice', () => {
    expect(voiceForAccent('en-GH')).toBe('bf_emma')
    expect(voiceForAccent('en-IN')).toBe('bf_emma')
  })

  it('falls back to British for an unknown accent rather than throwing', () => {
    expect(voiceForAccent('en-ZZ')).toBe('bf_emma')
    expect(voiceForAccent('')).toBe('bf_emma')
  })

  it('only ever returns a voice Kokoro actually ships', () => {
    for (const accent of ['en-US', 'en-GB', 'en-NG', 'en-GH', 'en-IN', 'en-ZZ']) {
      expect(KOKORO_VOICES.map((v) => v.id)).toContain(voiceForAccent(accent))
    }
  })
})

describe('KOKORO_VOICES', () => {
  it('labels every voice and says which have no Nigerian equivalent', () => {
    expect(KOKORO_VOICES.length).toBeGreaterThan(0)
    for (const v of KOKORO_VOICES) {
      expect(v.id).toMatch(/^[ab][fm]_/)
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.accent).toMatch(/^en-/)
    }
  })

  it('ships no African or Indian English voice — the documented limitation', () => {
    expect(KOKORO_VOICES.map((v) => v.accent)).not.toContain('en-NG')
    expect(KOKORO_VOICES.map((v) => v.accent)).not.toContain('en-IN')
  })
})

describe('ttsOptions', () => {
  it('passes the chosen voice through', () => {
    expect(ttsOptions('bf_emma', 1)).toEqual({ voice: 'bf_emma', speed: 1 })
  })

  it('clamps speed into a range the model handles', () => {
    expect(ttsOptions('bf_emma', 5).speed).toBe(2)
    expect(ttsOptions('bf_emma', 0).speed).toBe(0.5)
  })
})

describe('model id', () => {
  it('is the ONNX Kokoro build', () => {
    expect(KOKORO_ID).toBe('onnx-community/Kokoro-82M-v1.0-ONNX')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run server/voice/kokoro.test.ts`
Expected: FAIL — `Failed to resolve import "./voices.ts"`.

- [ ] **Step 4: Write `server/voice/voices.ts`**

```ts
export interface KokoroVoice {
  id: string
  label: string
  accent: string
  gender: 'female' | 'male'
}

/**
 * Kokoro-82M's English voices.
 *
 * Note the absence of Nigerian, Ghanaian, and Indian English. Kokoro does not
 * ship them; the accent picker maps those onto British and the UI says so.
 */
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: 'af_heart', label: 'Heart (US, warm)', accent: 'en-US', gender: 'female' },
  { id: 'af_bella', label: 'Bella (US, bright)', accent: 'en-US', gender: 'female' },
  { id: 'am_michael', label: 'Michael (US, calm)', accent: 'en-US', gender: 'male' },
  { id: 'am_fenrir', label: 'Fenrir (US, deep)', accent: 'en-US', gender: 'male' },
  { id: 'bf_emma', label: 'Emma (UK, clear)', accent: 'en-GB', gender: 'female' },
  { id: 'bf_isabella', label: 'Isabella (UK, soft)', accent: 'en-GB', gender: 'female' },
  { id: 'bm_george', label: 'George (UK, measured)', accent: 'en-GB', gender: 'male' },
  { id: 'bm_lewis', label: 'Lewis (UK, low)', accent: 'en-GB', gender: 'male' },
]

export const DEFAULT_VOICE = 'bf_emma'

/** Accent id -> Kokoro voice. Anything without a native voice falls back to British. */
export function voiceForAccent(accent: string): string {
  const exact = KOKORO_VOICES.find((v) => v.accent === accent)
  if (exact) return exact.id
  return DEFAULT_VOICE
}
```

The browser's accent list in `src/lib/voice/tutor-speak.ts` carries its own `approx` flag rather than importing anything from here — `src/` and `server/` are separate compilation units and neither may import the other. Keep the two lists in step by hand.

- [ ] **Step 5: Add Kokoro to the worker**

In `server/voice/worker.ts`, add near the top:

```ts
export const KOKORO_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

const SPEED_MIN = 0.5
const SPEED_MAX = 2

export function ttsOptions(voice: string, speed: number): Record<string, unknown> {
  return { voice, speed: Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed)) }
}
```

Add a second lazily-created pipeline alongside `asrPipe`:

```ts
type TtsPipe = (
  text: string,
  opts?: Record<string, unknown>,
) => Promise<{ audio: Float32Array; sampling_rate: number }>

let ttsPipe: TtsPipe | null = null

async function getTts(id: number): Promise<TtsPipe> {
  if (ttsPipe) return ttsPipe
  await configure()
  const { pipeline } = await import('@huggingface/transformers')
  const pipe = await pipeline('text-to-speech', KOKORO_ID, {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (info: { status?: string; progress?: number }) => {
      post({ id, type: 'progress', kind: 'tts', progress: info.progress ?? 0 })
    },
  })
  ttsPipe = pipe as unknown as TtsPipe
  return ttsPipe
}

async function synthesize(id: number, text: string, voice: string, speed: number) {
  const tts = await getTts(id)
  const out = await tts(text, ttsOptions(voice, speed))
  return { pcm: out.audio, sampleRate: out.sampling_rate }
}
```

Extend the message handler's union to `'asr' | 'warm' | 'tts'` and add a branch:

```ts
if (msg.kind === 'tts') {
  const result = await synthesize(msg.id, msg.text ?? '', msg.voice ?? DEFAULT_VOICE, msg.speed ?? 1)
  post({ id: msg.id, ok: true, result }, [result.pcm.buffer])
  return
}
```

Import `DEFAULT_VOICE` from `./voices.ts`, and change `post` to accept an optional transfer list:

```ts
function post(message: unknown, transfer?: readonly ArrayBuffer[]) {
  parentPort?.postMessage(message, transfer as never)
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server/voice`
Expected: PASS — the new kokoro tests plus all Phase 1 worker and client tests still green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/voice/worker.ts server/voice/voices.ts server/voice/kokoro.test.ts
git commit -m "Add Kokoro TTS to the voice worker with an accent-to-voice map

phonemizer is Kokoro's phonemiser and an optional peer of
@huggingface/transformers, so it must be installed explicitly."
```

---

### Task 3: Extend the client and add the TTS route

**Files:**
- Modify: `server/voice/client.ts`
- Create: `server/routes/tts.ts`
- Test: `server/routes/tts.test.ts`
- Test: `server/voice/client.test.ts` (extend)

**Interfaces:**
- Consumes: `encodeWav`, `KOKORO_RATE` (Task 1); worker `'tts'` kind (Task 2).
- Produces: `VoiceClient.synthesize(text: string, voice: string, speed: number): Promise<{ wav: Buffer }>`, `VoiceStatus.tts`, `createTtsHandler(deps: { voice: VoiceClient }): (req, res) => Promise<void>`. Task 8 consumes the endpoint.

- [ ] **Step 1: Write the failing client tests**

Append to `server/voice/client.test.ts`:

```ts
describe('createVoiceClient — synthesis', () => {
  it('sends a tts request and returns encoded WAV', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.synthesize('Delta U equals Q minus W', 'bf_emma', 1)

    const sent = s.sent[0]! as unknown as { kind: string; text: string; voice: string }
    expect(sent.kind).toBe('tts')
    expect(sent.text).toBe('Delta U equals Q minus W')
    expect(sent.voice).toBe('bf_emma')

    s.reply({
      id: (s.sent[0]! as { id: number }).id,
      ok: true,
      result: { pcm: new Float32Array([0, 0.5]), sampleRate: 24000 },
    })

    const { wav } = await pending
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.length).toBe(44 + 4)
  })

  it('rejects empty text without touching the worker', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    await expect(client.synthesize('   ', 'bf_emma', 1)).rejects.toThrow(/nothing to speak/i)
    expect(s.sent.length).toBe(0)
  })

  it('tracks a separate tts state from asr', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.synthesize('hello', 'bf_emma', 1)
    s.progress((s.sent[0] as { id: number }).id, 20)
    expect(client.status().tts).toMatchObject({ state: 'loading' })
    expect(client.status().asr.state).toBe('cold')
    s.reply({ id: (s.sent[0] as { id: number }).id, ok: true, result: { pcm: new Float32Array(1), sampleRate: 24000 } })
    await pending
  })
})
```

> The `progress` helper in the existing stub sends `{ id, type: 'progress', progress }` with no `kind`. Update it to accept an optional kind and forward it: `progress: (id, progress, kind) => listeners.message.forEach((l) => l({ id, type: 'progress', progress, kind }))`. Without this the client cannot route progress to the right model.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/voice/client.test.ts`
Expected: FAIL — `client.synthesize is not a function`.

- [ ] **Step 3: Extend `server/voice/client.ts`**

Add to the interface:

```ts
export interface VoiceStatus {
  asr: { state: VoiceState; progress: number; error?: string }
  tts: { state: VoiceState; progress: number; error?: string }
}

export interface VoiceClient {
  transcribe(pcm: Float32Array): Promise<string>
  synthesize(text: string, voice: string, speed: number): Promise<{ wav: Buffer }>
  warm(): Promise<void>
  status(): VoiceStatus
  dispose(): Promise<void>
}
```

Import `encodeWav` from `./wav.ts`. Initialize `const status: VoiceStatus = { asr: { state: 'cold', progress: 0 }, tts: { state: 'cold', progress: 0 } }`.

In the message handler, route progress by kind and resolve the right model's state:

```ts
if (msg.type === 'progress') {
  const slot = msg.kind === 'tts' ? status.tts : status.asr
  slot.state = 'loading'
  slot.progress = Math.round(msg.progress ?? 0)
  return
}
```

Track which slot each request belongs to, so a reply updates the matching one. Extend `Pending`:

```ts
interface Pending {
  slot: 'asr' | 'tts'
  resolve: (value: never) => void
  reject: (err: Error) => void
}
```

and in the resolve path use `status[p.slot] = { state: 'ready', progress: 100 }`.

Add the method:

```ts
async synthesize(text, voice, speed) {
  const spoken = text.trim()
  if (!spoken) throw new Error('Nothing to speak.')
  const result = (await send('tts', undefined, {
    text: spoken,
    voice,
    speed,
  })) as unknown as { pcm: Float32Array; sampleRate: number }
  return { wav: encodeWav(result.pcm, result.sampleRate) }
},
```

Widen `send` to carry extra fields:

```ts
function send(
  kind: 'asr' | 'warm' | 'tts',
  pcm?: Float32Array,
  extra?: Record<string, unknown>,
): Promise<{ text?: string }> {
  if (disposed) return Promise.reject(new Error('Voice client is disposed.'))
  const w = ensure()
  const id = nextId++
  const slot = kind === 'tts' ? 'tts' : 'asr'
  if (status[slot].state === 'cold') status[slot] = { state: 'loading', progress: 0 }
  return new Promise((resolve, reject) => {
    pending.set(id, { slot, resolve: resolve as (v: never) => void, reject })
    const transfer = pcm ? [pcm.buffer] : undefined
    w.postMessage({ id, kind, pcm, ...extra }, transfer)
  })
}
```

- [ ] **Step 4: Run to verify the client tests pass**

Run: `npx vitest run server/voice/client.test.ts`
Expected: PASS — Phase 1 tests plus 3 new ones.

- [ ] **Step 5: Update the Phase 1 test fixtures for the widened interfaces**

Two Phase 1 test files build their own `VoiceClient` stand-ins, and both now fail to typecheck. Add the two new members to each.

In `server/routes/asr.test.ts`, `fakeVoice` becomes:

```ts
function fakeVoice(overrides: Partial<VoiceClient> = {}): VoiceClient {
  const status: VoiceStatus = {
    asr: { state: 'ready', progress: 100 },
    tts: { state: 'cold', progress: 0 },
  }
  return {
    transcribe: async () => 'delta U equals Q minus W',
    synthesize: async () => ({ wav: Buffer.from('RIFF____WAVE') }),
    warm: async () => undefined,
    status: () => status,
    dispose: async () => undefined,
    ...overrides,
  }
}
```

In `server/routes/health.test.ts`, both inline `VoiceClient` literals gain `synthesize: async () => ({ wav: Buffer.alloc(0) })`, and both `status` callbacks gain `tts: { state: 'cold', progress: 0 }` alongside the existing `asr`.

Run: `npx tsc -b && npx vitest run server`
Expected: exits 0 and all tests pass. Task 6 replaces the health fixtures wholesale; this step just keeps the tree green in between.

- [ ] **Step 6: Write the failing route tests**

Create `server/routes/tts.test.ts`:

```ts
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceClient } from '../voice/client.ts'
import { createTtsHandler } from './tts.ts'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

function fakeVoice(overrides: Partial<VoiceClient> = {}): VoiceClient {
  return {
    transcribe: async () => '',
    synthesize: async () => ({ wav: Buffer.from('RIFF____WAVE') }),
    warm: async () => undefined,
    status: () => ({
      asr: { state: 'ready', progress: 100 },
      tts: { state: 'ready', progress: 100 },
    }),
    dispose: async () => undefined,
    ...overrides,
  }
}

async function serve(voice: VoiceClient) {
  const handler = createTtsHandler({ voice })
  server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((r) => server!.listen(0, r))
  const addr = server!.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return `http://127.0.0.1:${addr.port}/api/tts`
}

function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/tts', () => {
  it('returns audio/wav for speakable text', async () => {
    const url = await serve(fakeVoice())
    const res = await post(url, { text: 'Delta U equals Q minus W.' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('audio/wav')
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString('ascii')).toBe('RIFF')
  })

  it('defaults the voice when none is given', async () => {
    let seen = ''
    const url = await serve(
      fakeVoice({
        synthesize: async (_t, voice) => {
          seen = voice
          return { wav: Buffer.from('RIFF____WAVE') }
        },
      }),
    )
    await post(url, { text: 'hello' })
    expect(seen).toBe('bf_emma')
  })

  it('defaults speed to 1', async () => {
    let seen = 0
    const url = await serve(
      fakeVoice({
        synthesize: async (_t, _v, speed) => {
          seen = speed
          return { wav: Buffer.from('RIFF____WAVE') }
        },
      }),
    )
    await post(url, { text: 'hello' })
    expect(seen).toBe(1)
  })

  it('rejects a missing text field with 400', async () => {
    const url = await serve(fakeVoice())
    expect((await post(url, {})).status).toBe(400)
  })

  it('rejects non-JSON with 400', async () => {
    const url = await serve(fakeVoice())
    const res = await fetch(url, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('returns 503 when the model is unavailable', async () => {
    const url = await serve(
      fakeVoice({
        synthesize: async () => {
          throw new Error('the voice worker stopped unexpectedly')
        },
      }),
    )
    expect((await post(url, { text: 'hello' })).status).toBe(503)
  })
})
```

- [ ] **Step 7: Write `server/routes/tts.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError, readBody, sendError } from '../http.ts'
import type { VoiceClient } from '../voice/client.ts'
import { DEFAULT_VOICE } from '../voice/voices.ts'

interface TtsBody {
  text?: string
  voice?: string
  speed?: number
}

function parseBody(raw: Buffer): Required<TtsBody> {
  let json: TtsBody
  try {
    json = JSON.parse(raw.toString('utf8')) as TtsBody
  } catch {
    throw new HttpError(400, 'Expected a JSON body.')
  }
  const text = (json.text ?? '').trim()
  if (!text) throw new HttpError(400, 'Missing "text".')
  const speed = Number(json.speed ?? 1)
  return {
    text,
    voice: json.voice?.trim() || DEFAULT_VOICE,
    speed: Number.isFinite(speed) ? speed : 1,
  }
}

export function createTtsHandler(deps: { voice: VoiceClient }) {
  return async function handleTts(req: IncomingMessage, res: ServerResponse) {
    try {
      const { text, voice, speed } = parseBody(await readBody(req))
      const { wav } = await deps.voice.synthesize(text, voice, speed)
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': wav.length,
        'Cache-Control': 'no-store',
      })
      res.end(wav)
    } catch (e) {
      if (e instanceof HttpError) {
        sendError(res, e.status, e.message)
        return
      }
      const message = e instanceof Error ? e.message : 'Speech synthesis failed.'
      sendError(res, /nothing to speak/i.test(message) ? 400 : 503, message)
    }
  }
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run server`
Expected: PASS — the full server suite.

- [ ] **Step 9: Commit**

```bash
git add server/voice/client.ts server/routes/tts.ts server/voice/client.test.ts server/routes/tts.test.ts server/routes/asr.test.ts server/routes/health.test.ts
git commit -m "Add POST /api/tts returning WAV, with per-model status tracking"
```

---

### Task 4: SSE reader and the Gemini model list, server-side

**Files:**
- Create: `src/lib/sse.ts`
- Test: `src/lib/sse.test.ts`
- Create: `server/gemini/models.ts`
- Test: `server/gemini/models.test.ts`
- Delete: `src/lib/gemini/models.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readSseText(res: Response): AsyncGenerator<string>`, `parseSseBlock(block: string): string | null`; `FREE_CHAT_MODELS`, `DEFAULT_CHAT_MODEL`, `isFreeChatModel(id)`, `fallbackChatModels(preferred)`. Task 5 consumes all of these.

- [ ] **Step 1: Write the failing SSE tests**

Create `src/lib/sse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSseBlock, readSseText } from './sse'

/** Build a Response whose body arrives in the given chunks, verbatim. */
function streamOf(chunks: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body)
}

function chunk(text: string) {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`
}

async function collect(res: Response) {
  const out: string[] = []
  for await (const t of readSseText(res)) out.push(t)
  return out
}

describe('parseSseBlock', () => {
  it('extracts candidate text', () => {
    expect(parseSseBlock(chunk('hello').trim())).toBe('hello')
  })

  it('returns null for the DONE sentinel', () => {
    expect(parseSseBlock('data: [DONE]')).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseSseBlock('data: {not json')).toBeNull()
  })

  it('returns null when there is no data line', () => {
    expect(parseSseBlock('event: ping')).toBeNull()
  })

  it('returns null when the candidate has no text', () => {
    expect(parseSseBlock('data: {"candidates":[]}')).toBeNull()
  })

  it('joins multiple parts in one candidate', () => {
    const block = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'delta ' }, { text: 'U' }] } }],
    })}`
    expect(parseSseBlock(block)).toBe('delta U')
  })
})

describe('readSseText', () => {
  it('yields each frame', async () => {
    expect(await collect(streamOf([chunk('one'), chunk('two')]))).toEqual(['one', 'two'])
  })

  it('reassembles a frame split across two reads', async () => {
    // the exact hazard the old client.ts handled: a boundary lands mid-frame
    const whole = chunk('split across reads')
    const cut = Math.floor(whole.length / 2)
    expect(await collect(streamOf([whole.slice(0, cut), whole.slice(cut)]))).toEqual([
      'split across reads',
    ])
  })

  it('reassembles a frame split mid-JSON', async () => {
    const whole = chunk('boundary inside the object')
    const at = whole.indexOf('candidates') + 3
    expect(await collect(streamOf([whole.slice(0, at), whole.slice(at)]))).toEqual([
      'boundary inside the object',
    ])
  })

  it('skips a malformed frame and keeps reading', async () => {
    expect(await collect(streamOf([chunk('good'), 'data: {broken\n\n', chunk('after')]))).toEqual([
      'good',
      'after',
    ])
  })

  it('handles an empty body', async () => {
    expect(await collect(streamOf([]))).toEqual([])
  })

  it('handles a body with no trailing blank line', async () => {
    expect(await collect(streamOf([chunk('unterminated').trimEnd()]))).toEqual([])
  })
})
```

The last test documents a real limitation: a frame with no terminating blank line is buffered and never emitted. Gemini always terminates frames, so this is acceptable — and now it is pinned rather than accidental.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/sse.test.ts`
Expected: FAIL — `Failed to resolve import "./sse"`.

- [ ] **Step 3: Write `src/lib/sse.ts`**

Moved from `src/lib/gemini/client.ts:36-70`, split so the parsing is testable without a stream.

```ts
/** Extract the text from one SSE block, or null if it carries none. */
export function parseSseBlock(block: string): string | null {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return null
  const raw = dataLine.slice(5).trim()
  if (!raw || raw === '[DONE]') return null
  try {
    const json = JSON.parse(raw) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
    return text || null
  } catch {
    return null
  }
}

/** Yield the text of each SSE frame as it arrives. Blocks are split on a blank line. */
export async function* readSseText(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const text = parseSseBlock(block)
      if (text) yield text
    }
  }
}
```

- [ ] **Step 4: Run to verify the SSE tests pass**

Run: `npx vitest run src/lib/sse.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Write the failing model-list tests**

Create `server/gemini/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_MODEL,
  FREE_CHAT_MODELS,
  fallbackChatModels,
  isFreeChatModel,
} from './models.ts'

describe('DEFAULT_CHAT_MODEL', () => {
  it('is a 3.x free model, not the access-restricted 2.5 family', () => {
    expect(DEFAULT_CHAT_MODEL).toBe('gemini-3.5-flash-lite')
  })

  it('is itself in the free list', () => {
    expect(isFreeChatModel(DEFAULT_CHAT_MODEL)).toBe(true)
  })
})

describe('FREE_CHAT_MODELS', () => {
  it('excludes the 2.5 family, which new keys cannot reach', () => {
    const ids = FREE_CHAT_MODELS.map((m) => m.id)
    expect(ids).not.toContain('gemini-2.5-flash')
    expect(ids).not.toContain('gemini-2.5-flash-lite')
  })

  it('includes only ids the free tier serves', () => {
    for (const m of FREE_CHAT_MODELS) {
      expect(m.id).toMatch(/^gemini-3(\.\d+)?-flash(-lite)?$/)
    }
  })

  it('labels every model', () => {
    for (const m of FREE_CHAT_MODELS) expect(m.label.length).toBeGreaterThan(0)
  })
})

describe('fallbackChatModels', () => {
  it('puts the preferred model first', () => {
    expect(fallbackChatModels('gemini-3.8-flash')[0]).toBe('gemini-3.8-flash')
  })

  it('falls back to the default for an unknown or restricted choice', () => {
    expect(fallbackChatModels('gemini-2.5-flash')[0]).toBe(DEFAULT_CHAT_MODEL)
    expect(fallbackChatModels('nonsense')[0]).toBe(DEFAULT_CHAT_MODEL)
  })

  it('never repeats a model', () => {
    const list = fallbackChatModels('gemini-3.5-flash-lite')
    expect(new Set(list).size).toBe(list.length)
  })

  it('ends with the whole free list, so a bad model still resolves', () => {
    const list = fallbackChatModels('gemini-3.8-flash')
    expect(list.length).toBe(FREE_CHAT_MODELS.length)
  })
})
```

- [ ] **Step 6: Write `server/gemini/models.ts`**

```ts
/**
 * Free-tier Gemini text models only.
 * Verified against https://ai.google.dev/gemini-api/docs/pricing (Oct 2026).
 *
 * The 2.5 family is deliberately absent. Google restricts it to accounts that
 * already used it, so a freshly issued key is refused — listing it here is how
 * the setup harness used to fail for new users.
 *
 * TTS models (gemini-3.8-flash-tts and friends) are also free of charge, but
 * are not used: this project synthesises speech locally with Kokoro. That is a
 * choice, not a pricing constraint.
 */
export const FREE_CHAT_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: '3.5 Flash-Lite' },
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite' },
  { id: 'gemini-3.5-flash', label: '3.5 Flash' },
  { id: 'gemini-3.6-flash', label: '3.6 Flash' },
  { id: 'gemini-3.7-flash', label: '3.7 Flash' },
  { id: 'gemini-3.8-flash', label: '3.8 Flash' },
] as const

export const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash-lite'

export const FREE_CHAT_IDS = FREE_CHAT_MODELS.map((m) => m.id)

export function isFreeChatModel(id: string) {
  return (FREE_CHAT_IDS as readonly string[]).includes(id)
}

/** The preferred model first, then every other free model as a fallback. */
export function fallbackChatModels(preferred: string) {
  const head = isFreeChatModel(preferred) ? preferred : DEFAULT_CHAT_MODEL
  return [...new Set([head, ...FREE_CHAT_IDS])]
}
```

- [ ] **Step 7: Detach the frontend settings from the old model list**

**Do not delete `src/lib/gemini/models.ts` in this task.** Its other consumer is
`src/components/studio/settings-drawer.tsx:5`, which is not rewritten until Task 9 — deleting the
module here would leave `tsc -b` failing across Tasks 4 through 8, so no intermediate commit could
be used as a gate. Task 10 removes the file once the drawer no longer imports it.

Leave it in place and patch only `src/lib/storage.ts`. Delete the import on line 1 and change the
`model` default to `''`:

```ts
export const defaultSettings: PersistedSettings = {
  geminiKey: '', // removed in Task 8 — leave until then
  model: '',     // '' means "use the server's default"
  // ...unchanged
}
```

Replace the validation line in `loadSettings`:

```ts
if (!isFreeChatModel(parsed.model)) parsed.model = DEFAULT_CHAT_MODEL
```

with:

```ts
// an unknown model id is not worth rejecting — the server falls back
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run && npx tsc -b`
Expected: tests PASS and `tsc -b` exits 0. Because `src/lib/gemini/models.ts` was deliberately left
in place (Step 7), the settings drawer still resolves its import and the tree stays green — every
commit in this phase must typecheck, since each one is a gate for the next.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Move the model list server-side and drop the access-restricted 2.5 family

A fresh API key cannot reach gemini-2.5-flash, which is why the setup
harness Connect step failed for new users."
```

---

### Task 5: The tutor route

**Files:**
- Modify: `server/env.ts`
- Modify: `server/env.test.ts`
- Create: `server/routes/tutor.ts`
- Test: `server/routes/tutor.test.ts`
- Delete: `src/lib/gemini/client.ts`

**Interfaces:**
- Consumes: `readBody`, `sendError`, `HttpError` (Phase 1 Task 3); `fallbackChatModels`, `DEFAULT_CHAT_MODEL` (Task 4).
- Produces: `ServerConfig.geminiKey: string`, `ServerConfig.geminiModel: string`; `createTutorHandler(deps: { config: ServerConfig; fetchImpl?: typeof fetch }): (req, res) => Promise<void>`. Task 8 consumes the endpoint.

- [ ] **Step 1: Extend the config tests**

Append to `server/env.test.ts`:

```ts
describe('readConfig — gemini', () => {
  it('reads GEMINI_API_KEY', () => {
    expect(readConfig({ GEMINI_API_KEY: 'AIza-test' }).geminiKey).toBe('AIza-test')
  })

  it('trims surrounding whitespace from the key', () => {
    expect(readConfig({ GEMINI_API_KEY: '  AIza-test\n' }).geminiKey).toBe('AIza-test')
  })

  it('defaults the key to empty rather than throwing', () => {
    expect(readConfig({}).geminiKey).toBe('')
  })

  it('defaults the model to the current free default', () => {
    expect(readConfig({}).geminiModel).toBe('gemini-3.5-flash-lite')
  })

  it('honours GEMINI_MODEL', () => {
    expect(readConfig({ GEMINI_MODEL: 'gemini-3.8-flash' }).geminiModel).toBe('gemini-3.8-flash')
  })

  it('ignores a blank GEMINI_MODEL', () => {
    expect(readConfig({ GEMINI_MODEL: '   ' }).geminiModel).toBe('gemini-3.5-flash-lite')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/env.test.ts`
Expected: FAIL — `cfg.geminiKey` is `undefined`.

- [ ] **Step 3: Extend `server/env.ts`**

```ts
import { DEFAULT_CHAT_MODEL } from './gemini/models.ts'

export interface ServerConfig {
  port: number
  modelDir: string
  production: boolean
  geminiKey: string
  geminiModel: string
}
```

and inside `readConfig`, before the return:

```ts
const geminiKey = (env.GEMINI_API_KEY ?? '').trim()
const geminiModel = (env.GEMINI_MODEL ?? '').trim() || DEFAULT_CHAT_MODEL
```

adding `geminiKey,` and `geminiModel,` to the returned object.

- [ ] **Step 4: Run to verify the config tests pass**

Run: `npx vitest run server/env.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Write the failing tutor route tests**

Create `server/routes/tutor.test.ts`:

```ts
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../env.ts'
import { createTutorHandler } from './tutor.ts'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

const config: ServerConfig = {
  port: 0,
  modelDir: '/tmp/models',
  production: false,
  geminiKey: 'AIza-secret',
  geminiModel: 'gemini-3.5-flash-lite',
}

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const text of chunks) {
          c.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`,
            ),
          )
        }
        c.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

async function serve(fetchImpl: typeof fetch, cfg: ServerConfig = config) {
  const handler = createTutorHandler({ config: cfg, fetchImpl })
  server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((r) => server!.listen(0, r))
  const addr = server!.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return `http://127.0.0.1:${addr.port}/api/tutor`
}

function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Decode our own SSE frames back into the reply text.
 *
 * Deliberately mirrors the browser-side reader rather than reaching for it —
 * server tests must not import from src/, and pinning the format here is the
 * point: this helper and readSseText must agree.
 */
async function readStream(res: Response) {
  const raw = await res.text()
  return raw
    .split('\n\n')
    .map((block) => block.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map((json) => (JSON.parse(json) as { text: string }).text)
    .join('')
}

const turn = { userText: 'Explain the first law.', mode: 'teach', history: [] }

describe('POST /api/tutor', () => {
  it('streams the reply as SSE frames the browser reader can parse', async () => {
    const url = await serve(async () => sseResponse(['Delta ', 'U equals Q minus W.']))
    const res = await post(url, turn)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(await readStream(res)).toBe('Delta U equals Q minus W.')
  })

  it('writes each chunk as a data frame, never as a bare string', async () => {
    const url = await serve(async () => sseResponse(['Delta ', 'U']))
    const raw = await (await post(url, turn)).text()
    // a bare "Delta " would produce no frame at all and readSseText would yield nothing
    expect(raw).toContain('data: {"text":"Delta "}')
    expect(raw).not.toMatch(/^(?!data:)\S/m)
  })

  it('sends the key in a header, never in the URL', async () => {
    let seenUrl = ''
    let seenKey = ''
    const url = await serve(async (input, init) => {
      seenUrl = String(input)
      seenKey = (init?.headers as Record<string, string>)['x-goog-api-key'] ?? ''
      return sseResponse(['ok'])
    })
    await post(url, turn)
    expect(seenKey).toBe('AIza-secret')
    expect(seenUrl).not.toContain('AIza')
  })

  it('targets the configured model', async () => {
    let seenUrl = ''
    const url = await serve(async (input) => {
      seenUrl = String(input)
      return sseResponse(['ok'])
    })
    await post(url, turn)
    expect(seenUrl).toContain('/models/gemini-3.5-flash-lite:streamGenerateContent')
    expect(seenUrl).toContain('alt=sse')
  })

  it('never leaks the key in the response body', async () => {
    const url = await serve(async () => sseResponse(['ok']))
    expect(await (await post(url, turn)).text()).not.toContain('AIza-secret')
  })

  it('returns 503 with an explanatory message when no key is configured', async () => {
    const url = await serve(async () => sseResponse(['ok']), { ...config, geminiKey: '' })
    const res = await post(url, turn)
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/GEMINI_API_KEY/)
  })

  it('rejects a missing userText with 400', async () => {
    const url = await serve(async () => sseResponse(['ok']))
    expect((await post(url, { mode: 'teach' })).status).toBe(400)
  })

  it('surfaces a mid-stream upstream failure instead of ending silently', async () => {
    const encoder = new TextEncoder()
    const url = await serve(async () => {
      let n = 0
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            if (n++ === 0) {
              c.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'half ' }] } }] })}\n\n`,
                ),
              )
              return
            }
            c.error(new Error('upstream reset'))
          },
        }),
        { status: 200 },
      )
    })
    const text = await readStream(await post(url, turn))
    expect(text).toContain('half')
    expect(text).toMatch(/cut short/i)
  })

  it('retries the next free model when the preferred one is refused', async () => {
    const tried: string[] = []
    const url = await serve(async (input) => {
      tried.push(String(input))
      if (tried.length === 1) return new Response('quota', { status: 429 })
      return sseResponse(['ok from fallback'])
    })
    const res = await post(url, turn)
    expect(tried.length).toBe(2)
    expect(await readStream(res)).toBe('ok from fallback')
  })

  it('does not leak the upstream error body when every model fails', async () => {
    const url = await serve(async () => new Response('quota details', { status: 429 }))
    const res = await post(url, turn)
    expect((await res.json()).error).not.toContain('quota details')
  })
})
```

- [ ] **Step 6: Write `server/routes/prompt.ts`**

The system prompt moves server-side along with the key. Copy `tutorSystem` from `src/lib/gemini/prompt.ts:4-61` verbatim; the only change is that `IntegrityMode` is now declared here rather than imported:

```ts
export type IntegrityMode = 'teach' | 'practice' | 'assessment' | 'review'

export function tutorSystem(opts: {
  name: string
  student: string
  course: string
  notation: string
  mode: IntegrityMode
  fileNames: string[]
}): string {
  // body copied verbatim from src/lib/gemini/prompt.ts:4-61
}
```

Leave `src/lib/gemini/prompt.ts` in place — `speakable()` still lives there and the browser uses it. Task 7 moves `speakable` out and Task 10 deletes the file. Nothing in `src/` may import `server/routes/prompt.ts`; the two prompt copies coexist only for the span of this phase.

- [ ] **Step 7: Write `server/routes/tutor.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ServerConfig } from '../env.ts'
import { fallbackChatModels } from '../gemini/models.ts'
import { HttpError, readBody, sendError } from '../http.ts'
import { tutorSystem } from './prompt.ts'

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/models'

interface TutorBody {
  userText?: string
  model?: string
  mode?: string
  course?: string
  notation?: string
  student?: string
  tutorName?: string
  history?: { role: 'user' | 'model'; text: string }[]
  files?: { name: string; mime: string; base64: string }[]
}

function parseBody(raw: Buffer): TutorBody {
  let json: TutorBody
  try {
    json = JSON.parse(raw.toString('utf8')) as TutorBody
  } catch {
    throw new HttpError(400, 'Expected a JSON body.')
  }
  if (!(json.userText ?? '').trim()) throw new HttpError(400, 'Missing "userText".')
  return json
}

function fileParts(files: TutorBody['files']) {
  return (files ?? []).slice(0, 4).flatMap((f) => {
    if (f.mime.startsWith('text/')) {
      try {
        return [{ text: `FILE ${f.name}:\n${Buffer.from(f.base64, 'base64').toString('utf8')}` }]
      } catch {
        return []
      }
    }
    return [
      { text: `Course file: ${f.name}` },
      { inlineData: { mimeType: f.mime, data: f.base64 } },
    ]
  })
}

export function createTutorHandler(deps: { config: ServerConfig; fetchImpl?: typeof fetch }) {
  const doFetch = deps.fetchImpl ?? fetch

  return async function handleTutor(req: IncomingMessage, res: ServerResponse) {
    let body: TutorBody
    try {
      body = parseBody(await readBody(req))
    } catch (e) {
      if (e instanceof HttpError) return sendError(res, e.status, e.message)
      return sendError(res, 400, 'Could not read the request.')
    }

    if (!deps.config.geminiKey) {
      sendError(
        res,
        503,
        'No GEMINI_API_KEY is set on the server. Add it to .env and restart.',
      )
      return
    }

    const system = tutorSystem({
      name: body.tutorName ?? 'Amina',
      student: body.student ?? 'the student',
      course: body.course ?? '',
      notation: body.notation ?? '',
      mode: (body.mode ?? 'teach') as never,
      fileNames: (body.files ?? []).map((f) => f.name),
    })

    const contents = [
      ...(body.history ?? []).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      {
        role: 'user' as const,
        parts: [
          ...fileParts(body.files),
          {
            text: (body.files ?? []).length
              ? `Answer from the attached course files only.\n${body.userText}`
              : (body.userText as string),
          },
        ],
      },
    ]

    const requested = body.model?.trim() || deps.config.geminiModel
    let upstream: Response | null = null
    for (const model of fallbackChatModels(requested)) {
      const attempt = await doFetch(
        `${UPSTREAM}/${model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': deps.config.geminiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
          }),
        },
      ).catch(() => null)
      if (attempt?.ok && attempt.body) {
        upstream = attempt
        break
      }
    }

    if (!upstream?.body) {
      // Deliberately generic: the upstream body can echo request content back.
      sendError(res, 502, 'Every free Gemini model refused the request. Check the key and quota.')
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    })

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()

    /**
     * Upstream speaks SSE and so do we. Re-encode rather than forwarding raw
     * frames: upstream's envelope carries far more than the text, and the
     * browser's readSseText only ever yields `data:` lines.
     */
    const emit = (text: string) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`)
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw || raw === '[DONE]') continue
          try {
            const parsed = JSON.parse(raw) as {
              candidates?: { content?: { parts?: { text?: string }[] } }[]
            }
            const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
            if (text) emit(text)
          } catch {
            /* skip malformed frame */
          }
        }
      }
    } catch {
      // A frame, not a bare string — the reader only yields data: lines, so a
      // notice written any other way would be swallowed and the reply would
      // just stop mid-sentence with no explanation.
      emit('\n\n[Sabi: the reply was cut short. Check your connection and quota.]')
    } finally {
      res.end()
    }
  }
}
```

The `emit` helper is what makes the route and `readSseText` (Task 4) agree. Both sides of this
contract are pinned by tests: the frames here, the reader in Task 4.

- [ ] **Step 8: Run the tutor tests**

Run: `npx vitest run server/routes/tutor.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 9: Delete the old client and add the env template**

```bash
git rm src/lib/gemini/client.ts
```

Create `.env.example`:

```
# Copy to .env. Never commit .env.
GEMINI_API_KEY=AIza...
# Optional. Must be one of the free Flash / Flash-Lite ids.
GEMINI_MODEL=gemini-3.5-flash-lite
# Optional. Defaults to 5173.
PORT=5173
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add POST /api/tutor as the only path to Gemini

The key now lives only in the server environment; the browser sends text
and receives a plain text stream."
```

---

### Task 6: Mount the new routes and report health honestly

**Files:**
- Modify: `server/main.ts`
- Modify: `server/routes/health.ts`
- Modify: `server/routes/health.test.ts`

**Interfaces:**
- Consumes: `createTtsHandler` (Task 3), `createTutorHandler` (Task 5), `/api/health` shape (Task 4).
- Produces: the complete HTTP surface. Tasks 7–9 consume it.

- [ ] **Step 1: Extend the health tests**

`createHealthHandler` now takes a config as well as a voice, so the two Phase 1 tests in `server/routes/health.test.ts` are updated in the same pass: delete the old `readHealth` helper and its local `VoiceClient` literals, and point both tests at the `readFull` helper below.

Add these imports at the top of the file:

```ts
import type { ServerConfig } from '../env.ts'
import type { VoiceClient } from '../voice/client.ts'
```

Then append the new tests and fixtures:

```ts
describe('GET /api/health — gemini and tts', () => {
  it('reports whether a key is configured, without revealing it', async () => {
    const body = await readFull({
      config: { ...baseConfig, geminiKey: 'AIza-secret' },
      voice,
    })
    expect(body.gemini.configured).toBe(true)
    expect(JSON.stringify(body)).not.toContain('AIza-secret')
  })

  it('reports configured:false when the key is missing', async () => {
    const body = await readFull({ config: { ...baseConfig, geminiKey: '' }, voice })
    expect(body.gemini.configured).toBe(false)
  })

  it('publishes the model list so the frontend has no second copy', async () => {
    const body = await readFull({ config: baseConfig, voice })
    expect(body.gemini.models.map((m: { id: string }) => m.id)).toContain('gemini-3.5-flash-lite')
  })

  it('reports the tts state', async () => {
    const body = await readFull({ config: baseConfig, voice })
    expect(body.tts).toMatchObject({ state: 'ready' })
  })

  it('publishes the Kokoro voice list', async () => {
    const body = await readFull({ config: baseConfig, voice })
    expect(body.tts.voices.map((v: { id: string }) => v.id)).toContain('bf_emma')
  })
})
```

Add the shared fixtures at the top of that file, alongside the existing tests:

```ts
const baseConfig: ServerConfig = {
  port: 0,
  modelDir: '/tmp/models',
  production: false,
  geminiKey: '',
  geminiModel: 'gemini-3.5-flash-lite',
}

const voice: VoiceClient = {
  transcribe: async () => '',
  synthesize: async () => ({ wav: Buffer.alloc(0) }),
  warm: async () => undefined,
  status: () => ({
    asr: { state: 'ready', progress: 100 },
    tts: { state: 'ready', progress: 100 },
  }),
  dispose: async () => undefined,
}

/** Boot the handler and return the parsed body. */
async function readFull(deps: { config: ServerConfig; voice: VoiceClient }) {
  const handler = createHealthHandler(deps)
  const s = createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => s.listen(0, r))
  const addr = s.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`)
  const body = await res.json()
  s.close()
  return body as {
    ok: boolean
    asr: { state: string; progress: number }
    gemini: { configured: boolean; models: { id: string }[] }
    tts: { state: string; voices: { id: string }[] }
  }
}
```

The two Phase 1 tests become, keeping their original intent:

```ts
describe('GET /api/health', () => {
  it('reports the worker state', async () => {
    const body = await readFull({ config: baseConfig, voice })
    expect(body.ok).toBe(true)
    expect(body.asr).toMatchObject({ state: 'ready', progress: 100 })
  })

  it('is 200 even when the worker is in error, so the UI can render the reason', async () => {
    const failing: VoiceClient = {
      ...voice,
      status: () => ({
        asr: { state: 'error', progress: 0, error: 'boom' },
        tts: { state: 'cold', progress: 0 },
      }),
    }
    const body = await readFull({ config: baseConfig, voice: failing })
    expect(body.asr).toMatchObject({ state: 'error' })
  })
})
```

- [ ] **Step 2: Rewrite `server/routes/health.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ServerConfig } from '../env.ts'
import { FREE_CHAT_MODELS } from '../gemini/models.ts'
import { sendJson } from '../http.ts'
import type { VoiceClient } from '../voice/client.ts'
import { KOKORO_VOICES } from '../voice/voices.ts'

/**
 * Report what the UI needs to explain itself. The key is reported only as a
 * boolean — it must never appear in a response body.
 */
export function createHealthHandler(deps: { config: ServerConfig; voice: VoiceClient }) {
  return function handleHealth(_req: IncomingMessage, res: ServerResponse) {
    const { asr, tts } = deps.voice.status()
    sendJson(res, 200, {
      ok: true,
      gemini: {
        configured: deps.config.geminiKey.length > 0,
        model: deps.config.geminiModel,
        models: FREE_CHAT_MODELS,
      },
      asr,
      tts: { ...tts, voices: KOKORO_VOICES },
    })
  }
}
```

Note one deliberate departure from the spec's API table, which lists `gemini: {configured, reachable, model}`. There is no `reachable`. Answering it honestly means a live round trip to Google, and `/api/health` is polled once a second while a model downloads — that would be a request per second to a third party for a status line. `configured` is what the UI actually needs, and a failed turn already reports its own error. `models` is added in its place so the settings dropdown has no second copy of the list.

- [ ] **Step 3: Mount the routes in `server/main.ts`**

Extend the `routes` function:

```ts
if (url.pathname === '/api/tts' && req.method === 'POST') {
  void handleTts(req, res)
  return true
}
if (url.pathname === '/api/tutor' && req.method === 'POST') {
  void handleTutor(req, res)
  return true
}
```

and construct the handlers alongside the existing two:

```ts
const handleTts = createTtsHandler({ voice })
const handleTutor = createTutorHandler({ config })
const handleHealth = createHealthHandler({ config, voice })
```

Add a boot warning after `announce()` runs:

```ts
if (!config.geminiKey) {
  console.warn(
    '[sabi] GEMINI_API_KEY is not set. The studio will load but the tutor will not answer.\n' +
      '       Copy .env.example to .env and add your key from https://aistudio.google.com/apikey',
  )
}
```

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`, then:

```bash
curl -s http://localhost:5173/api/health | head -c 400
```

Expected: JSON containing `"gemini":{"configured":true,...}`, the model list, and `"tts":{"state":"cold",...,"voices":[...]}`.

```bash
curl -s -X POST http://localhost:5173/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Delta U equals Q minus W."}' \
  -o /tmp/sabi-tts.wav && file /tmp/sabi-tts.wav
```

Expected: `RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, mono 24000 Hz`. Play it: `aplay /tmp/sabi-tts.wav` (or `ffplay`).

- [ ] **Step 5: Commit**

```bash
git add server/main.ts server/routes/health.ts server/routes/health.test.ts
git commit -m "Mount tts and tutor routes; health reports config without the key"
```

---

### Task 7: Backend voice in the browser

Replaces Web Speech with real audio, and — because the audio is now real — drives the orb from an actual waveform instead of the current fake.

**Files:**
- Modify: `src/lib/voice/tutor-speak.ts`
- Modify: `src/lib/voice/types.ts`
- Modify: `src/lib/gemini/prompt.ts`
- Modify: `src/lib/api.ts` (extends `Health` with `tts` and `VoiceOption`)
- Modify: `src/components/studio/settings-drawer.tsx` (voice picker; the Gemini panel waits for Task 9)
- Create: `src/lib/voice/speakable.ts`
- Test: `src/lib/voice/speakable.test.ts`
- Modify: `src/pages/Studio.tsx`
- Modify: `src/components/classroom/whiteboard.tsx`

**Interfaces:**
- Consumes: `POST /api/tts` (Task 6), `KOKORO_VOICES` via `/api/health` (Task 6).
- Produces: `speakable(text: string): string` in `src/lib/voice/speakable.ts`; `speakTutor(opts: { text: string; voice?: string; accent?: string; speed?: number; onAmp?: (n: number) => void }): Promise<void>`; `stopTutorVoice(): void`; `ACCENTS`. Task 9 consumes `ACCENTS`.

- [ ] **Step 1: Write the failing `speakable` tests**

`speakMath` is currently in `src/lib/latex.ts`. Read it before writing these tests, and if it behaves differently from the expectations below, adjust the expectations to match reality — do not change `speakMath`, which is used elsewhere.

Create `src/lib/voice/speakable.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { speakable } from './speakable'

describe('speakable', () => {
  it('removes board blocks entirely', () => {
    expect(speakable('Here is the step.\n<board title="First law">\nΔU = Q − W\n</board>')).not.toMatch(
      /board|ΔU/,
    )
  })

  it('removes fenced code', () => {
    expect(speakable('See this:\n```\nx = 1\n```\ndone')).not.toContain('x = 1')
  })

  it('returns an empty string for a reply that is only a board', () => {
    // the case that must skip the TTS round trip
    expect(speakable('<board title="Only math">\nΔU = Q − W\n</board>').trim()).toBe('')
  })

  it('keeps ordinary prose', () => {
    expect(speakable('Work through it one line at a time.')).toContain('one line at a time')
  })

  it('keeps a spoken sentence that stands outside the board', () => {
    const out = speakable('So delta U equals Q minus W.\n<board title="x">\nΔU = Q − W\n</board>')
    expect(out).toContain('delta U equals Q minus W')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/voice/speakable.test.ts`
Expected: FAIL — `Failed to resolve import "./speakable"`.

- [ ] **Step 3: Move `speakable` out of `prompt.ts`**

Create `src/lib/voice/speakable.ts`:

```ts
import { speakMath } from '@/lib/latex'

/**
 * Reduce a tutor reply to the words that should be spoken.
 *
 * Board contents and fenced code are written, not said — the tutor narrates
 * around them. A reply that is nothing but a board reduces to an empty string,
 * and the caller must skip synthesis rather than request silence.
 */
export function speakable(text: string): string {
  const stripped = text
    .replace(/<board\b[^>]*>/gi, ' ')
    .replace(/<\/board>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
  return speakMath(stripped)
}
```

Delete `speakable` from `src/lib/gemini/prompt.ts` and drop its now-unused `speakMath` import there.

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/voice/speakable.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Rewrite `src/lib/voice/tutor-speak.ts`**

The whole file is replaced. Web Speech is gone; `listOnDeviceVoices` and `voicesForAccent` go with it.

```ts
import { speakable } from './speakable'

/**
 * The tutor's voice, synthesised by the Sabi backend with Kokoro.
 *
 * Gemini writes the text; Kokoro speaks it on this machine. Nothing here talks
 * to Google, and no model runs in the page — the browser plays a WAV and
 * measures it for the orb.
 */

let current: { stop: () => void } | null = null
let audioCtx: AudioContext | null = null

export const ACCENTS = [
  { id: 'en-NG', label: 'Nigerian English', approx: true },
  { id: 'en-GB', label: 'British English', approx: false },
  { id: 'en-US', label: 'American English', approx: false },
  { id: 'en-IN', label: 'Indian English', approx: true },
  { id: 'en-GH', label: 'Ghanaian English', approx: true },
] as const

export function stopTutorVoice() {
  current?.stop()
  current = null
}

export async function speakTutor(opts: {
  text: string
  voice?: string
  speed?: number
  onAmp?: (n: number) => void
}): Promise<void> {
  stopTutorVoice()
  const said = speakable(opts.text)
  if (!said.trim()) return

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: said, voice: opts.voice || undefined, speed: opts.speed ?? 1 }),
  })
  if (!res.ok) {
    let detail = `Speech failed (${res.status}).`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {
      /* not JSON */
    }
    throw new Error(detail)
  }

  await playBlob(await res.blob(), opts.onAmp)
}

/** Play a WAV through WebAudio so the orb can measure the real waveform. */
function playBlob(blob: Blob, onAmp?: (n: number) => void) {
  return new Promise<void>((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.crossOrigin = 'anonymous'

    let raf = 0
    let source: MediaElementAudioSourceNode | null = null
    let analyser: AnalyserNode | null = null
    let data: Uint8Array<ArrayBuffer> | null = null

    try {
      audioCtx ??= new AudioContext()
      source = audioCtx.createMediaElementSource(audio)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyser.connect(audioCtx.destination)
      data = new Uint8Array(analyser.frequencyBinCount)
    } catch {
      // WebAudio unavailable — fall back to plain playback, no orb data.
      onAmp?.(0)
    }

    const tick = () => {
      if (analyser && data) {
        analyser.getByteFrequencyData(data)
        let sum = 0
        for (const v of data) sum += v
        onAmp?.(Math.min(1, sum / data.length / 128))
      }
      raf = requestAnimationFrame(tick)
    }

    const finish = () => {
      cancelAnimationFrame(raf)
      onAmp?.(0)
      URL.revokeObjectURL(url)
      source?.disconnect()
      analyser?.disconnect()
      current = null
      resolve()
    }

    audio.onended = finish
    audio.onerror = finish

    current = {
      stop: () => {
        audio.pause()
        finish()
      },
    }

    void audioCtx?.resume()
    void audio.play().then(() => {
      if (analyser) raf = requestAnimationFrame(tick)
    })
  })
}
```

- [ ] **Step 6: Update `Studio.tsx`'s call site**

In the `ask` callback, the existing block reads:

```ts
if (settings.speak && parsed.speech) {
  setState('speaking')
  await speakTutor({
    voiceName: settings.voiceName,
    accent: settings.accent,
    text: parsed.speech,
    onAmp: setAmp,
  })
}
```

Change it to:

```ts
if (settings.speak && parsed.speech) {
  setState('speaking')
  await speakTutor({
    voice: settings.voiceName || undefined,
    text: parsed.speech,
    onAmp: setAmp,
  })
}
```

There is a second call site, in `src/components/classroom/whiteboard.tsx`. Its `run()` function builds a local `say()` helper that passes `voiceName` and `accent` through. Change it to:

```tsx
    async function run() {
      const say = async (raw: string) => {
        const line = speakMath(raw)
        if (!line) return
        onCaption?.(line)
        if (!speak) {
          await wait(420)
          return
        }
        await speakTutor({
          text: line,
          voice: voiceName || undefined,
          onAmp,
        })
      }
```

Note `say()` already runs `speakMath` before calling, and `speakTutor` runs `speakable` (which ends in `speakMath`) again. That double pass is harmless — `speakMath` over plain prose is close to a no-op — and it is what makes the captions match the audio. Do not "fix" it by removing the `speakMath` in `say()`; the captions depend on it.

If `whiteboard.tsx`'s `accent` prop is now unused, remove it from the props type and from the parent that renders `Whiteboard`, or `noUnusedParameters` will fail the build. Follow the compiler rather than guessing at the call sites.

- [ ] **Step 7: Update the settings drawer's voice picker**

This belongs in this task, not Task 9: the rewrite in Step 5 just removed `listOnDeviceVoices`
from `src/lib/voice/tutor-speak.ts`, and `src/components/studio/settings-drawer.tsx:6,19` is its
only consumer. Leaving the drawer until Task 9 would break the build for two commits.

First extend `Health` in `src/lib/api.ts` with the fields this task consumes — it currently only
knows about `asr`:

```ts
export interface VoiceOption {
  id: string
  label: string
  accent: string
  gender: 'female' | 'male'
}

export interface Health {
  ok: boolean
  asr: AsrStatus
  tts: { state: AsrStatus['state']; progress: number; voices: VoiceOption[] }
}
```

Task 8 adds the `gemini` fields it needs in the same place.

Now, in `src/components/studio/settings-drawer.tsx`, line 6's import loses the removed helper:

```ts
import { ACCENTS } from '@/lib/voice/tutor-speak'
```

Replace the `listOnDeviceVoices` state and its `voiceschanged` listener with the server's voice
list, `health?.tts.voices ?? []`. Set each option's value to `v.id` and its label to
`` `${v.label} · ${v.accent}` ``.

Load the health payload once when the drawer opens:

```tsx
const [health, setHealth] = useState<Health | null>(null)
useEffect(() => {
  if (!open) return
  getHealth()
    .then(setHealth)
    .catch(() => setHealth(null))
}, [open])
```

with

```tsx
import { getHealth, type Health } from '@/lib/api'
```

Change the "Custom voice (this device)" label to **Tutor voice**, and replace the paragraph beneath
it with:

```tsx
{accentChoice?.approx ? (
  <p className="text-[12px] text-danger">
    Kokoro has no {accentChoice.label} voice. This accent uses the closest British voice —
    pronunciation will not be Nigerian.
  </p>
) : null}
<p className="text-[12px] text-muted">
  Spoken by the Sabi backend on this machine with Kokoro-82M. Nothing is sent to Google, and no
  speech model runs in your browser. Formulas are never spoken.
</p>
```

with, near the top of the component:

```tsx
const accentChoice = ACCENTS.find((a) => a.id === settings.accent)
```

The `approx` flag comes from `ACCENTS` in `src/lib/voice/tutor-speak.ts`, **not** from the server's
`server/voice/voices.ts`. The two trees are separate compilation units and neither may import the
other, so each carries its own copy of the accent knowledge. Keep them in step by hand — there are
five entries and they change only when Kokoro ships a new language.

- [ ] **Step 8: Verify the voice by hand**

Run: `npm run dev`, open the Studio, ask a question with Speak replies on.

Expected: the tutor's reply is spoken by Kokoro; the orb moves in time with the **actual audio** rather than the old random jitter; the Stop button cuts the sentence mid-playback; a reply that is only a `<board>` is never sent to `/api/tts`; and the settings drawer's voice list now comes from `/api/health` with no `speechSynthesis` call anywhere.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Replace Web Speech with backend Kokoro playback

The orb is now driven by an AnalyserNode on the real waveform instead of a
random-interval placeholder."
```

---

### Task 8: Frontend talks to /api/tutor

**Files:**
- Modify: `src/lib/gemini/tutor.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/pages/Assessment.tsx`

**Interfaces:**
- Consumes: `POST /api/tutor` (Task 6), `readSseText` (Task 4).
- Produces: `streamTutorReply(opts)` with no `apiKey`. Tasks 9 and 10 consume it.

- [ ] **Step 1: Rewrite `src/lib/gemini/tutor.ts`**

The file shrinks. There is no key, no URL construction, and no fallback loop — the server owns all three.

```ts
import { readSseText } from '@/lib/sse'
import type { StoredFile } from '@/lib/storage'
import type { IntegrityMode } from '@/lib/course/types'

export interface GeminiTurn {
  role: 'user' | 'model'
  text: string
}

/**
 * Ask the tutor. The server holds the API key and does the model fallback;
 * this function only ships the turn and reads the stream back.
 */
export async function* streamTutorReply(opts: {
  model: string
  tutorName: string
  student: string
  course: string
  notation: string
  mode: IntegrityMode
  history: GeminiTurn[]
  userText: string
  files: StoredFile[]
}) {
  const res = await fetch('/api/tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      tutorName: opts.tutorName,
      student: opts.student,
      course: opts.course,
      notation: opts.notation,
      mode: opts.mode,
      history: opts.history,
      userText: opts.userText,
      files: opts.files.map((f) => ({ name: f.name, mime: f.mime, base64: f.base64 })),
    }),
  })

  if (!res.ok) {
    let detail = `The tutor is unavailable (${res.status}).`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {
      /* not JSON */
    }
    throw new Error(detail)
  }

  for await (const chunk of readSseText(res)) yield chunk
}
```

- [ ] **Step 2: Remove the key from settings**

In `src/lib/storage.ts`, delete `geminiKey: string` from `PersistedSettings` and `geminiKey: ''` from `defaultSettings`. Leave `model: ''`.

- [ ] **Step 3: Update `Assessment.tsx`**

Remove the `apiKey: settings.geminiKey` property from its `streamTutorReply` call. Nothing else changes.

- [ ] **Step 4: Update `Studio.tsx`**

Remove `apiKey: settings.geminiKey,` from the `streamTutorReply` call in `ask`. Change the guard at the top of `ask` — it currently blocks on a missing key:

```ts
if (!settings.geminiKey) {
  setHarness(true)
  return
}
```

Replace with a health-backed check. Add to the component:

```ts
const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null)
```

and extend the health poll to run once on mount:

```ts
useEffect(() => {
  getHealth()
    .then((h) => setGeminiConfigured(h.gemini.configured))
    .catch(() => setGeminiConfigured(null))
}, [])
```

The `Health` interface in `src/lib/api.ts` gains the `gemini` block — Task 7 already added `tts`
and `VoiceOption`, so add only this one field:

```ts
export interface Health {
  ok: boolean
  asr: AsrStatus
  tts: { state: AsrStatus['state']; progress: number; voices: VoiceOption[] }
  // added here:
  gemini: {
    configured: boolean
    model: string
    models: { id: string; label: string }[]
  }
}
```

Then in `ask`:

```ts
if (geminiConfigured === false) {
  setErr('The server has no GEMINI_API_KEY. Add it to .env and restart.')
  return
}
```

- [ ] **Step 5: Verify the loop end to end**

Run: `npm run dev`. Speak a question.

Expected: transcript → `/api/tutor` streams → reply renders → Kokoro speaks it. In DevTools → Application → Local Storage, `sabi.settings` has no `geminiKey`. In the Network tab, **no request goes to `generativelanguage.googleapis.com`** from the page.

- [ ] **Step 6: Verify a missing key is explained, not silent**

Stop the server, run `GEMINI_API_KEY= npm run dev`, and ask a question.

Expected: a readable message naming `GEMINI_API_KEY`, and a startup warning in the terminal. The Studio still loads and the board still renders.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Point the frontend at /api/tutor and drop geminiKey from settings"
```

---

### Task 9: Harness and settings rewrites

**Files:**
- Modify: `src/components/harness/setup-harness.tsx`
- Modify: `src/components/studio/settings-drawer.tsx`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `/api/health` (Task 6), `ACCENTS` (Task 7).
- Produces: the finished UI.

- [ ] **Step 1: Collapse the harness to one step**

Two steps become one — there is no key for the student to paste. In `setup-harness.tsx`:

- Delete the `key` and `show` state, the `verify` function, the `Input`/`Button` key form, and the `pingGemini` import.
- Start at the files step. Keep `HARNESS 1 / 1` in the heading.
- Add a health probe shown before the file drop:

```tsx
const [backend, setBackend] = useState<string | null>(null)
useEffect(() => {
  getHealth()
    .then((h) =>
      setBackend(
        h.gemini.configured
          ? null
          : 'The server has no GEMINI_API_KEY. Add it to .env and restart — you can still load files now.',
      ),
    )
    .catch(() => setBackend('Cannot reach the Sabi backend. Is `npm run dev` running?'))
}, [])
```

Render `backend` as a warning line above the drop zone when non-null.

- [ ] **Step 2: Rewrite the Gemini section of the settings drawer**

Replace the API-key `Input`, the model `<select>` populated from `FREE_CHAT_MODELS`, the "Test key" button, and the `isFreeChatModel`/`pingGemini`/`FREE_CHAT_MODELS` imports with a status panel fed by `/api/health`:

```tsx
<section className="mt-8 grid gap-3">
  <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Gemini · server</p>
  {health ? (
    <p className="text-[12px] text-muted">
      {health.gemini.configured
        ? 'A key is configured on the server. It never reaches this browser.'
        : 'No key configured. Add GEMINI_API_KEY to .env and restart the server.'}
    </p>
  ) : (
    <p className="text-[12px] text-muted">Cannot reach the backend.</p>
  )}
  <label className="text-sm text-muted grid gap-1">
    Chat model
    <select
      className="h-11 bg-elevated border border-border px-3 text-foreground"
      value={settings.model || (health?.gemini.model ?? '')}
      onChange={(e) => patchSettings({ model: e.target.value })}
    >
      {(health?.gemini.models ?? []).map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  </label>
</section>
```

Section 2 of Task 9 Step 2 — the Gemini panel — needs `Health` and `getHealth` in scope:

```tsx
import { getHealth, type Health } from '@/lib/api'
```

Load `health` once on open:

```tsx
const [health, setHealth] = useState<Health | null>(null)
useEffect(() => {
  if (!open) return
  getHealth()
    .then(setHealth)
    .catch(() => setHealth(null))
}, [open])
```

Note the dropdown is populated **from the server**, so there is no second copy of the model list to drift.

- [ ] **Step 3: Remove the Vite Gemini proxy**

In `vite.config.ts`, delete the `geminiProxy` const and both `proxy: geminiProxy` entries from `server` and `preview`, and delete the now-unused `preview` block entirely. This is the last thing that let the browser reach Google directly.

- [ ] **Step 4: Typecheck, lint, and test**

Run: `npx tsc -b && npm run lint && npx vitest run`
Expected: all exit 0.

- [ ] **Step 5: Verify no key can leave the browser**

Run: `npm run dev`, open DevTools → Network, use the app fully — speak, ask, hear a reply — then search the whole network log for `AIza`.

Expected: **zero matches.** Also confirm `localStorage['sabi.settings']` has no `geminiKey`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Rewrite harness and settings for a server-held key; drop the Vite proxy"
```

---

### Task 10: Documentation, dead code, and the production path

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Delete: `src/lib/gemini/prompt.ts`
- Modify: `src/lib/voice/types.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a repository that matches its own documentation.

- [ ] **Step 1: Delete the last two orphans**

Two modules have now outlived their consumers. **Check before deleting — if either grep prints a
hit, fix that import instead of deleting the file.**

`src/lib/gemini/prompt.ts` lost `speakable` in Task 7, and `tutorSystem` moved to
`server/routes/prompt.ts` in Task 5:

```bash
grep -rn "gemini/prompt" src
```

`src/lib/gemini/models.ts` was left in place by Task 4 (Step 7 there explains why) and lost its
last consumer when Task 9 rewrote the settings drawer:

```bash
grep -rn "gemini/models" src
```

When both greps print nothing, delete them:

```bash
git rm src/lib/gemini/models.ts src/lib/gemini/prompt.ts
rmdir src/lib/gemini 2>/dev/null || true
```

`src/lib/gemini/` may still hold `tutor.ts`, which stays — `rmdir` removes the directory only if it
is empty.

- [ ] **Step 2: Prune `src/lib/voice/types.ts`**

With `controller.ts` gone, only `VoiceState` and `voiceStateCopy` remain in use. Confirm with `grep -rn "voiceStateCopy" src`, then reduce the file to those two exports.

- [ ] **Step 3: Rewrite README §3 for the new voice stack**

Replace the "Voice on this device" table with:

```markdown
| Job | Engine | Where it runs |
| --- | --- | --- |
| **Listening** (you → text) | **Whisper small** | Sabi backend, on this machine |
| **Speaking** (tutor → you) | **Kokoro-82M** | Sabi backend, on this machine |
```

Replace the "Speaking — accent and custom voice" subsection:

```markdown
### Speaking — the tutor's voice

The tutor speaks with **Kokoro-82M**, running in the Sabi backend on your machine. Pick a voice
from gear → *Speaking*.

**Accents.** Kokoro ships American and British English voices only. Nigerian, Ghanaian, and
Indian English are offered in the picker but fall back to the closest British voice, and Sabi
says so when you select one. If a genuine Nigerian voice matters to you, this is the trade for
keeping speech local — it is a real limitation, not a setting you have missed.

True **voice cloning** from a recording is not installed. That needs the speaker's permission and
a separate training run.
```

Add a section on the key. Update §1 to say the key goes in `.env`:

```markdown
## 1. Install and start

```bash
cd sabi
npm install
cp .env.example .env      # then put your Gemini key in it
npm run dev
```

`npm run dev` starts one process: the app and the API together on
`http://localhost:5173`. The first recording downloads Whisper (~250 MB) and the first spoken
reply downloads Kokoro (~330 MB) into `server/.models/`. Both are one-time.
```

Replace §5's storage table:

```markdown
| Data | Place |
| --- | --- |
| Gemini API key | `.env` on this machine — never the browser |
| Model, accent, voice, course name, notation | `localStorage` key `sabi.settings` |
| Uploaded files | IndexedDB `sabi-v1` |
| Whisper and Kokoro weights | `server/.models/` |
```

Replace the "Could not reach Gemini" entry in §6:

```markdown
**"The server has no GEMINI_API_KEY"**  
Add your key to `.env` in the project root and restart `npm run dev`. Get one at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).
```

Add to §6:

```markdown
**Whisper or Kokoro stuck downloading**  
Both download on first use into `server/.models/`. Watch the terminal — progress prints there,
not in the browser. A corporate proxy or firewall can block `huggingface.co`.
```

- [ ] **Step 4: Update the README Commands block**

```bash
npm install      # dependencies
cp .env.example .env   # then add your Gemini key
npm run dev      # app + API at http://localhost:5173
npm run build    # production bundle
npm start        # serve the bundle and the API from one process
npm test         # unit tests
```

- [ ] **Step 5: Correct `DESIGN.md`**

Update the Whisper line to mention both models:

```
Whisper and Kokoro: **both run in the backend**, not the browser. The client decodes a recording
to 16 kHz mono PCM and posts it to `/api/asr`; `server/voice/worker.ts` runs `Xenova/whisper-small`
and `onnx-community/Kokoro-82M-v1.0-ONNX` on a worker thread, with weights cached in
`server/.models/`. Gemini writes text; it is never the voice.
```

- [ ] **Step 6: Verify the production path**

```bash
npm run build && npm start
```

Expected: the built app is served from `dist/`, `/api/health` responds, `/api/tutor` streams, and `/api/tts` returns audio — all from `:5173`, with no Vite in the picture. Then `curl -s http://localhost:5173/ | head -c 200` returns the bundled HTML.

- [ ] **Step 7: Final full check**

```bash
npx tsc -b && npm run lint && npx vitest run
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Document the backend voice stack and remove the last dead module"
```

---

## Phase 2 completion

Phase 2 is done when all of the following hold:

- The tutor's reply is audible, synthesised by backend Kokoro.
- The orb responds to the real waveform, not a random interval.
- No API key appears in `localStorage`, in the bundle, or in any request originating from the page.
- A fresh Gemini key passes the harness without any change to the model list.
- `/api/health` is the single source of the model and voice lists.
- Selecting a Nigerian accent states plainly that the voice will not be Nigerian.
- `npm run build && npm start` serves the bundle and the API from one process.
- `npx tsc -b`, `npm run lint`, and `npx vitest run` all pass.

