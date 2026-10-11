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
export async function transcribeWithWhisper(opts: {
  audio: Blob
  /** Which Whisper model to use. Omitted means the backend's default. */
  model?: string
}): Promise<string> {
  const { audio, model } = opts
  if (!audio || audio.size < 800) {
    throw new Error('Recording too short. Hold the mic and speak a full sentence.')
  }
  const pcm = await blobToMono16k(audio)
  return postAsr(pcm, model)
}

