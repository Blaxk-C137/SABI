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
  try {
    const raw = await blob.arrayBuffer()
    const buf = await decodeAudio(ctx, raw.slice(0))
    return decodeToMono16k(buf)
  } finally {
    await ctx.close().catch(() => undefined)
  }
}

