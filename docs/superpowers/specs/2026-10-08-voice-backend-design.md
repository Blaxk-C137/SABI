# Sabi — Voice & Model Backend

Date: 2026-10-08
Status: approved design, pending implementation plan
Branch: `feat/voice-backend`

## Problem

Sabi is a Vite + React single-page app with no server. Two symptoms follow from that.

**The browser does model inference.** `src/lib/voice/whisper.ts` loads `Xenova/whisper-small`
(~500 MB) through transformers.js into the page and runs it on WASM. The tab therefore carries
React, three.js orb rendering, a `MediaRecorder`, an `AudioContext` decode/resample of every
recording, and a quantised transformer model — all at once. On a normal laptop the browser becomes
noticeably slow while Sabi is open.

**The repository contradicts itself about Whisper.** Three sources disagree:

| Source | Claim |
| --- | --- |
| `DESIGN.md:7` | "Whisper: **not downloaded**. ASR is an interface with a Whisper provider stub." |
| `src/lib/voice/providers/whisper.ts` | `WHISPER_INSTALLED = false`; "Do not download Whisper models... in this build." |
| `src/lib/voice/whisper.ts` | Downloads and runs whisper-small in the browser. |
| `README.md` §3 | Instructs the user to preload 500 MB into the browser cache. |

The stub registry (`asr.ts`, `tts.ts`, `controller.ts`, `providers/*`) is dead code — verified
zero importers. The live path is `Studio.tsx:208`, which imports the browser-side implementation
directly. The design intent was "no Whisper"; what shipped was browser-side Whisper.

**Gemini is misconfigured.** `DEFAULT_CHAT_MODEL` is `gemini-2.5-flash`. Google now restricts the
2.5 family to accounts that previously used it and directs new projects to 3.5 Flash-Lite or
3.8 Flash. A fresh API key fails the setup harness `Connect` ping. Separately, the comment at
`models.ts:5` states that TTS models are excluded because they are paid — they are free of charge
on the current free tier, so the comment documents a constraint that does not exist.

## Goals

1. Move Whisper small out of the browser and into a local backend process.
2. `npm run dev` starts the frontend and the backend together, as one command.
3. Give the tutor a real local text-to-speech voice.
4. Fix the Gemini configuration so a new key works and the model list is honest.
5. Leave the repository self-consistent: one ASR story, no dead providers, accurate docs.

## Non-goals

- Deploying the backend to a remote host, or serving multiple clients from one instance.
- Voice cloning. `custom-tts.ts` is dead and stays deleted; cloning needs the speaker's
  permission and a separate training run.
- Migrating course files off IndexedDB. They stay in the browser and are POSTed per turn.
- Touching `lib/course/pipeline.ts`, which is also unreferenced but unrelated to this work.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| TTS engine | Local, Kokoro-82M | Preserves the project's "this device speaks and listens" principle. Works offline. |
| Gemini key | Server-side `GEMINI_API_KEY` in `.env` | One place to configure, never reaches the browser, no key in `localStorage`. |
| Course files | Stay in IndexedDB | Smallest change; preserves the existing storage model and Library page. |
| Server shape | Single Node process, Vite in middleware mode | One command, one port, no proxy, no CORS, dev and prod share a shape. |
| Audio transport | Browser sends 16 kHz mono `Float32` PCM | Node has no WebM/Opus decoder; `ffmpeg-static` is ~80 MB. The browser already does this well. |

### Accepted trade-off: accents

Kokoro ships en-US and en-GB voices only. It has no Nigerian, Ghanaian, or Indian English.
The existing accent picker (`tutor-speak.ts:19`) offers all three. `en-NG`, `en-GH`, and `en-IN`
will map to the closest British voice, and the UI will say so rather than implying an accent it
cannot produce. This is a real regression against Web Speech, which sometimes found a genuine
Nigerian voice installed on the host OS. It is the cost of local TTS and is accepted.

## Architecture

```
npm run dev
└─ node server/main.ts                      one process, port 5173
     ├─ Vite middleware  → src/, index.html, HMR        (dev only)
     ├─ static dist/                                    (prod only)
     ├─ /api/*           → server/routes/*
     └─ worker_thread    → server/voice/worker.ts
          ├─ Whisper small   ASR: audio → text
          └─ Kokoro-82M      TTS: text  → audio
```

Node 24.12 strips TypeScript types natively, so server files are plain `.ts` with no build step and
no `tsx`/`ts-node` dependency.

Inference runs in a `worker_thread`, not on the main thread. ONNX inference is CPU-bound; on the
main thread a long transcription would stall HMR and static asset serving.

### Model cache

Models download once to `server/.models/` (gitignored) via transformers.js `env.cacheDir`. They are
never fetched into the browser. `onnxruntime-node` is already a transitive dependency and already
ships the required linux/x64 and linux/arm64 binaries.

### Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `node --env-file-if-exists=.env server/main.ts` | Everything, port 5173 |
| `build` | `tsc -b && vite build` | Unchanged |
| `start` | `NODE_ENV=production node --env-file-if-exists=.env server/main.ts` | Serve `dist/` + API |
| `test` | `vitest run` | New |
| `lint` | `oxlint` | Unchanged |

`preview` is removed — `start` supersedes it.

## API

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/health` | — | `{ gemini: {configured, reachable, model}, asr: {state, progress}, tts: {state, progress, voices[]} }` |
| `POST /api/asr` | `application/octet-stream`, raw `Float32` LE PCM at 16 kHz | `200 {text, ms}` |
| `POST /api/tts` | `{text, voice, speed}` | `200 audio/wav` (mono, 16-bit, 24 kHz) |
| `POST /api/tutor` | `{model, mode, course, notation, student, tutorName, history, userText, files[]}` | `200 text/event-stream` |

`state` is `cold` | `loading` | `ready` | `error`. While a request triggers a first-run download, the
server records progress and the client polls `/api/health` to render it — this preserves the
existing "Whisper small · 43%" line in `Studio.tsx:346` without adding an SSE channel for status.

### Worker protocol

The main thread and `server/voice/worker.ts` exchange structured messages over
`parentPort.postMessage`. Each request carries an `id`; the worker replies with `{id, ok: true,
result}` or `{id, ok: false, error}`. Progress is a separate `{id, type: 'progress', progress}`
message, which the main thread writes into the status object that `/api/health` serves.

Two message kinds:

| `kind` | Payload | Result |
| --- | --- | --- |
| `asr` | `{pcm: Float32Array, language}` (transferred, not copied) | `{text}` |
| `tts` | `{text, voice, speed}` | `{pcm: Float32Array, sampleRate: 24000}` |

`Float32Array` buffers are passed as transferables in both directions, so audio crosses the thread
boundary without a copy.

## Data flow

**Voice in.** Mic → `MediaRecorder` (unchanged) → `decodeAudioData` + resample to 16 kHz mono
(unchanged, stays in the browser) → `POST /api/asr` → Whisper in worker → text → `POST /api/tutor`.

**Voice out.** `/api/tutor` SSE → `speakable()` strips `<board>` and LaTeX (unchanged) →
`POST /api/tts` → WAV → `<audio>` element + `AnalyserNode` → orb amplitude.

The orb currently fakes amplitude during speech with `0.28 + Math.random() * 0.45` on a 90 ms
interval (`tutor-speak.ts:87`). Real audio replaces the fake with a genuine spectrum, so the orb
moves to the tutor's actual voice.

**Files.** Assembled into base64 `parts` in the browser per turn, exactly as today; only the
destination changes from `generativelanguage.googleapis.com` to `/api/tutor`.

## Files

### Created

```
server/main.ts             HTTP server, Vite middleware, route mounting
server/env.ts              config parsing and validation
server/routes/health.ts
server/routes/asr.ts
server/routes/tts.ts
server/routes/tutor.ts     Gemini SSE proxy, holds the key
server/voice/worker.ts     owns both models, message-passing protocol
server/voice/wav.ts        Float32 PCM → WAV container
src/lib/api.ts             typed client helpers
src/lib/voice/pcm.ts       moved from whisper.ts: mixMono, resample, decode
.env.example
```

### Modified

| File | Change |
| --- | --- |
| `src/lib/voice/whisper.ts` | Drops model loading and transformers.js import; `transcribeWithWhisper` → `postAsr(pcm)` |
| `src/lib/voice/tutor-speak.ts` | Web Speech replaced by `/api/tts` playback + `AnalyserNode`; keeps `speakable()` and accent list |
| `src/lib/gemini/client.ts` | Drops `apiKey`; targets `/api/tutor` |
| `src/lib/gemini/tutor.ts` | Drops `apiKey` and the client-side fallback loop (moves server-side) |
| `src/lib/gemini/models.ts` | Default → `gemini-3.5-flash-lite`; 2.5 family dropped; stale TTS comment corrected |
| `src/lib/storage.ts` | `geminiKey` removed from `PersistedSettings`, defaults, and load |
| `src/components/harness/setup-harness.tsx` | Two steps → one; gates on `/api/health` instead of a key ping |
| `src/components/studio/settings-drawer.tsx` | Key field, "Test key", "Preload Whisper small" removed; backend status and Kokoro voice list added |
| `src/pages/Studio.tsx` | Swaps transcribe/speak calls; ASR progress now comes from `/api/health` |
| `src/pages/Assessment.tsx` | Same Gemini client swap |
| `src/lib/voice/types.ts` | Prunes `AsrProvider`, `TtsProvider`, `SpeechPlan`, `AsrProviderId`, `TtsProviderId` |
| `vite.config.ts` | Removes the `/v1beta` proxy (phase 2) |
| `package.json` | Scripts above; adds `phonemizer`, `vitest` |
| `README.md` | §3, §5, and §6 rewritten for the backend |
| `DESIGN.md` | Whisper line corrected |
| `.gitignore` | Adds `server/.models/`, `.env` |

### Deleted

All verified to have zero importers.

```
src/lib/voice/providers/whisper.ts          src/lib/voice/asr.ts
src/lib/voice/providers/demo-asr.ts         src/lib/voice/tts.ts
src/lib/voice/providers/web-speech-tts.ts   src/lib/voice/controller.ts
src/lib/voice/providers/custom-tts.ts       src/lib/gemini/asr.ts
src/components/assessment/voice-answer.tsx
```

### Dependency notes

`kokoro-js@1.2.1` requires `@huggingface/transformers@^3.5.1` while this project pins `^4.3.1`;
installing it would nest a second ~14 MB copy plus another `onnxruntime-node`. Instead the server
calls transformers.js 4.3.1's built-in `text-to-speech` pipeline directly. Only `phonemizer` is
added. Configuration is read via Node's `--env-file-if-exists`, so no `dotenv`.

## Model configuration

| | Whisper | Kokoro |
| --- | --- | --- |
| Repository | `Xenova/whisper-small` | `onnx-community/Kokoro-82M-v1.0-ONNX` |
| Task | `automatic-speech-recognition` | `text-to-speech` |
| dtype / device | `q8` / `cpu` | `q8` / `cpu` |
| Output | text | 24 kHz mono `Float32` |

Accent map: `en-US` → `af_heart`/`am_michael`; `en-GB` → `bf_emma`/`bm_george`;
`en-NG`, `en-GH`, `en-IN` → `bf_emma` (closest British), disclosed in the UI.

Whisper options carried over unchanged from `whisper.ts:60-71`: `language: 'english'`,
`task: 'transcribe'`, and `chunk_length_s: 20` / `stride_length_s: 4` above 28 seconds.

## Error handling

| Condition | Behaviour |
| --- | --- |
| `GEMINI_API_KEY` absent at boot | Warn loudly, keep serving. `/api/health` reports `configured: false`; `/api/tutor` returns 503. The UI shows a "backend key missing" state instead of failing silently. |
| Worker exits unexpectedly | Restart it; in-flight requests get 503 with a retry message. |
| Audio under 800 bytes or under 0.1 s after decode | 400 with the existing copy: "Recording too short. Hold the mic and speak a full sentence." |
| Transcript empty | 422 "Whisper heard silence. Speak closer to the mic." |
| TTS text empty after `speakable()` | Client skips the request; no round trip. |
| Model download fails | `/api/health` reports `state: 'error'` with the message; ASR/TTS return 503. |
| Gemini error mid-stream | SSE error frame; surfaced through the existing `explainError` path. |

## Testing

`vitest` is added; the repository currently has no test framework and no tests. Coverage targets
pure logic that fails silently:

- `mixMono` / `resample` — 48 kHz → 16 kHz output length; a known sine survives resampling
- `wavEncode` — RIFF header fields, byte offsets, declared 24 kHz
- the SSE parser — a block split across two reads (pin the behaviour at `client.ts:38`)
- `speakable` — strips `<board>`, keeps spoken math
- `fallbackChatModels` — new default first, deduped
- `POST /api/tts` — returns a well-formed WAV for a short string

Whisper and Kokoro themselves are verified **manually**, not in CI: together they need ~700 MB of
downloads and are slow. One integration test sits behind an env flag for on-demand use.

## Phases

**Phase 1 — backend and Whisper.** Server skeleton, worker, `/api/health`, `/api/asr`, `pcm.ts`,
`api.ts`, the `Studio.tsx` swap, the ASR-related deletions, `package.json` scripts, gitignore.
Gemini is untouched and the Vite proxy stays. **This phase alone resolves the browser-slowness
complaint.**

**Phase 2 — TTS and Gemini.** Kokoro, `/api/tts`, `/api/tutor`, the Gemini key move, `models.ts`
corrections, harness and settings-drawer rewrites, the Vite proxy removal, remaining deletions,
README and DESIGN updates.

## Verification

Phase 1 is done when: `npm run dev` starts one process on :5173; the network tab shows no request
to `huggingface.co` or `cdn-lfs`; `server/.models/` holds the Whisper weights; the browser's
memory profile no longer carries an ONNX runtime; speaking into the mic produces a transcript and
a tutor reply; killing the worker and retrying recovers.

Phase 2 is done when: the tutor's reply is audible from backend Kokoro; the orb responds to the
real waveform; no API key appears in `localStorage` or in any request to a third-party origin;
a fresh Gemini key passes the harness; `npm run build && npm start` serves the production bundle
and the API from one process.

