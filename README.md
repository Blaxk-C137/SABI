# Sabi — configure it on your device

Tutor studio. You talk or type. Gemini writes the lesson from **your PDFs**. This device speaks and listens. Gemini is never the voice.

## What you need

| Thing | Why |
| --- | --- |
| Node.js 22.18+ and npm | Run the app |
| Chrome or Edge (desktop) | Mic + on-device voices work best. Firefox is weaker for speech. |
| A **free** Gemini API key | Tutor text only. Get one at [Google AI Studio](https://aistudio.google.com/apikey) |
| Lecture PDFs / photos | The tutor is supposed to teach from these, not generic textbooks |
| Microphone (optional) | Voice in. Typing always works |

Your key, notes, and settings stay **on this device** (browser localStorage + IndexedDB). They are not uploaded to a Sabi server.

## 1. Install and start

In a terminal, from this folder:

```bash
cd sabi
npm install
npm run dev
```

Open the URL the server prints — usually `http://localhost:5173`.

First load can take a moment. Keep the terminal open while you work.

To stop: `Ctrl+C` in that terminal.

## 2. First-run harness (required)

On first open you get two steps.

### Step 1 — Gemini key

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and create a key (`AIza…`).
2. Paste it into **API key**.
3. Hit **Connect**. Sabi pings a free Flash model. If it fails, the key is wrong, billing/quota is blocked, or you are offline.

You can change the key later: gear icon → Gemini.

**Models:** only free Flash / Flash-Lite IDs. Paid models (Pro, TTS, Live, image) are not in the list on purpose.

### Step 2 — Course files

Drop lecture **PDFs**, slides, or board photos. The tutor is instructed to use these as the source of truth and keep your lecturer’s notation.

You can skip and add files later, but course-specific working is weaker without them.

Then **Enter studio**.

## 3. Voice on this device

Two different jobs. Do not mix them up.

| Job | Engine | Where to set it |
| --- | --- | --- |
| **Listening** (you → text) | **Whisper small** on this device, not Gemini | Gear → *Listening · Whisper small* |
| **Speaking** (tutor → you) | Browser **on-device voices** + accent, not Gemini TTS | Gear → *Speaking · accent & voice* |

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

### Speaking — accent and custom voice

Gear → **Speaking**:

1. **Accent** — Nigerian, British, American, Indian, or Ghanaian English. This sets the speech language (`en-NG`, `en-GB`, …).
2. **Custom voice (this device)** — any voice **already installed on your computer/phone**. Pick one, or leave **Auto for accent**.

**Windows:** Settings → Time & language → Speech → manage voices. Install e.g. British or Nigerian if your OS offers them, then refresh Sabi.

**macOS:** System Settings → Accessibility → Spoken Content → System voice. More voices download there.

**Android / iOS:** install extra TTS languages in system settings, then reopen the browser.

True **voice cloning** from a recording is not installed. That needs the speaker’s permission and a separate TTS train. Today, “custom voice” = pick a system voice + accent.

Also in gear:

- **Speak replies** — off = silent tutor, board still writes.
- **Show transcription** — captions of what the tutor is saying.

## 4. Use the studio

- Talk or type above the fold. No need to scroll to start.
- Modes: teach / practice / assessment / review (top).
- Drop more PDFs onto the studio, or add them in gear / Library.
- When the tutor works a derivation or calculation, a **classroom board** opens. Formulas render as LaTeX. The lecturer **talks through each line** (formulas in words, e.g. “delta U equals Q minus W”) while writing. **Duster** wipes. **Step back** returns to voice-only.
- Captions follow the spoken line. The board shows the real math.

## 5. Where things are stored

| Data | Place |
| --- | --- |
| API key, model, accent, voice, course name, notation | `localStorage` key `sabi.settings` |
| Uploaded files | IndexedDB `sabi-v1` |
| Whisper weights | `server/.models/` on this machine (never the browser) |

Clearing site data for `localhost` wipes the key, notes, and settings. It does not touch the
Whisper weights, which live in `server/.models/` — delete that directory to force a re-download.

To reset: browser DevTools → Application → Local storage + IndexedDB → delete `sabi.settings` and `sabi-v1`.

## 6. If something breaks

**“Could not reach Gemini”**  
Key invalid, no network, or free-tier quota. New key from AI Studio. Confirm Flash is allowed on that key.

**Mic blocked**  
Browser address bar → site settings → Microphone → Allow. Use `localhost` or HTTPS; `http://127.0.0.1` is usually fine, random IPs may not be.

**No tutor voice / wrong accent**  
The OS has no matching voice. Install one (section 3), reload, pick it under Custom voice. Chrome on desktop is the reliable path.

**Whisper stuck on 0%**  
The first recording downloads the model into `server/.models/`. Progress appears under the orb in the Studio as `Whisper small · N%` — the backend reports it over `/api/health`, so the terminal prints nothing. If the number never moves, check that machine's network, then gear → *Listening · Whisper small* → **Check voice backend**.

**Formulas look like raw `$...$`**  
Ask for a worked example so the board opens. Captions are spoken English; the board is KaTeX.

**Tutor ignores my PDF**  
Upload it first, then ask. It is told to refuse course-specific claims that are not in the files.

## Commands

```bash
npm install      # dependencies
npm run dev      # studio at http://localhost:5173
npm run build    # production bundle
npm start        # serve the built bundle
```

That is the whole device setup: key → PDFs → Whisper (listen) → system voice + accent (speak).


## Voice setup

The tutor speaks with **Piper**, a neural text-to-speech system that runs on this machine. Piper turns text into phonemes with espeak-ng, then a trained voice model synthesises the WAV. No audio or text goes to a speech service. The voices are medium-quality English models: Lessac (American), Jenny and Alan (British). Piper is synthetic speech, not a human recording.

Student speech is transcribed by **Whisper**, also on this machine.

- **Requirements:** Node 22.18 or newer, and Python 3.9 or newer (for Piper). If your Python is not called `python3`, set `SABI_PYTHON` to its path.
- **Install:** `npm install` as usual. A postinstall step creates a Python environment at `server/.models/piper-venv`, installs `piper-tts`, downloads the three Piper voices into `server/.models/piper/`, and downloads Whisper small.
- **More Whisper models:** `npm run models:all` adds base and tiny. `npm run models:install -- --force` reinstalls everything.
- **Runtime never downloads.** If a voice or model is missing, the app says so and names the command to run.
- Set `SABI_SKIP_MODELS=1` to skip the download during install.
- Use `SABI_PIPER_PYTHON` to point at a Python that already has `piper-tts` installed.
- Memory: expect roughly 1.5 GB while Whisper and Piper are both loaded.

### Custom voices

A Piper voice is two files that sit side by side: `<name>.onnx` (the model) and `<name>.onnx.json` (its config). To use one:

1. Put both files in `server/.models/piper/`.
2. Add an entry to `PIPER_VOICES` in `server/voice/voices.ts`, with `id` set to the file name without extension, a `label`, and an `accent` (`en-US` or `en-GB`). Leave out `hfPath`, so the installer does not try to download it.
3. Restart the server. The voice appears in Settings.

To train your own voice, use Piper's training tools (the `piper1-gpl` project's training guide). In short: prepare a folder of clean, single-speaker recordings with matching transcripts, fine-tune from an existing Piper checkpoint (this is much faster than training from scratch), then export the result to `.onnx` with `python -m piper.train.export_onnx`. Training is slow without a GPU and needs hours of audio for good results. Once exported, follow the steps above.

### Checks

- `npm test` runs the unit tests.
- `python3 scripts/e2e-board-flow.py` (dev server running) checks the reply order and board in a browser, with Gemini and TTS mocked.
- `node scripts/e2e-voice-roundtrip.ts` synthesises a sentence with Piper and transcribes it with Whisper tiny. Needs the models installed.
