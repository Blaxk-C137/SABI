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

  it('interpolates between samples at a non-integer ratio', () => {
    const ramp = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7])
    const out = resample(ramp, 44100, 16000)
    // ratio = 44100 / 16000 = 2.75625; outLen = round(8 / 2.75625) = 3
    expect(out.length).toBe(3)
    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[1]).toBeCloseTo(2.75625, 5)
    expect(out[2]).toBeCloseTo(5.5125, 5)
  })

  it('clamps the final sample instead of reading past the end', () => {
    const out = resample(Float32Array.from([0, 1, 2, 3]), 8000, 16000)
    // ratio = 0.5; outLen = round(4 / 0.5) = 8; last x = 3.5 -> i0 = 3, i1 clamps to 3
    expect(out.length).toBe(8)
    expect(out[7]).toBeCloseTo(3, 5)
    expect(Number.isNaN(out[7]!)).toBe(false)
  })
})

describe('decodeToMono16k', () => {
  it('downmixes and resamples in one step', () => {
    const out = decodeToMono16k(source([new Float32Array(48000), new Float32Array(48000)], 48000))
    expect(out.length).toBe(TARGET_RATE)
    for (const v of out) expect(v).toBeCloseTo(0, 6)
  })
})

