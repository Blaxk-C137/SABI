// Round trip: Piper speaks a sentence, Whisper (tiny) transcribes it back.
// Run with Node 22.18+:  node scripts/e2e-voice-roundtrip.ts
import { createVoiceClient } from '../server/voice/client.ts'
import { encodeWav } from '../server/voice/wav.ts'
import fs from 'node:fs'

const sentence = 'Delta U equals Q minus W.'
const client = createVoiceClient({ modelDir: new URL('../server/.models', import.meta.url).pathname })
const t0 = Date.now()
const { pcm, sampleRate } = await client.synthesize(sentence, { accent: 'en-GB' })
console.log(`tts: ${pcm.length} samples @${sampleRate} in ${Date.now() - t0} ms`)
fs.writeFileSync('/tmp/roundtrip.wav', encodeWav(pcm, sampleRate))

// Resample 24 kHz -> 16 kHz (Whisper's input rate) by linear interpolation.
const ratio = sampleRate / 16000
const out = new Float32Array(Math.floor(pcm.length / ratio))
for (let i = 0; i < out.length; i++) {
  const x = i * ratio
  const a = Math.floor(x)
  const f = x - a
  out[i] = (pcm[a] ?? 0) * (1 - f) + (pcm[a + 1] ?? 0) * f
}
const t1 = Date.now()
const text = await client.transcribe(out, 'Xenova/whisper-tiny')
console.log(`asr: "${text}" in ${Date.now() - t1} ms`)
console.log(JSON.stringify(client.status()))
await client.dispose()
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').trim()
console.log(norm(text).includes('delta u') && norm(text).includes('minus') ? 'RESULT: PASS' : 'RESULT: FAIL')
