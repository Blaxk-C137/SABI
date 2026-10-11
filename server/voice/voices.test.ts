import { describe, expect, it } from 'vitest'
import { clampSpeed, DEFAULT_VOICE, isPiperVoice, lengthScale, PIPER_VOICES, resolveVoice, voiceForAccent } from './voices.ts'

describe('PIPER_VOICES', () => {
  it('ships the three medium English voices, each with its Hugging Face path', () => {
    expect(PIPER_VOICES.map((v) => v.id)).toEqual([
      'en_US-lessac-medium',
      'en_GB-jenny_dioco-medium',
      'en_GB-alan-medium',
    ])
    for (const v of PIPER_VOICES) {
      expect(v.hfPath?.endsWith(`/${v.id}`)).toBe(true)
    }
  })

  it('defaults to a voice that ships', () => {
    expect(isPiperVoice(DEFAULT_VOICE)).toBe(true)
  })
})

describe('resolveVoice', () => {
  it('keeps a shipped voice the student chose', () => {
    expect(resolveVoice('en_GB-alan-medium', 'en-US')).toBe('en_GB-alan-medium')
  })

  it('uses the accent voice for an empty choice', () => {
    expect(resolveVoice('', 'en-US')).toBe('en_US-lessac-medium')
    expect(resolveVoice(undefined, 'en-GB')).toBe(voiceForAccent('en-GB'))
  })

  it('falls back to the accent for a Kokoro id left in saved settings', () => {
    expect(resolveVoice('bf_emma', 'en-GB')).toBe(voiceForAccent('en-GB'))
    expect(resolveVoice('af_heart', 'en-US')).toBe('en_US-lessac-medium')
  })

  it('maps accents Piper does not ship to a British voice', () => {
    for (const accent of ['en-NG', 'en-GH', 'en-IN']) {
      expect(isPiperVoice(voiceForAccent(accent))).toBe(true)
      expect(PIPER_VOICES.find((v) => v.id === voiceForAccent(accent))?.accent).toBe('en-GB')
    }
  })
})

describe('speed', () => {
  it('clamps to 0.5–2 and treats junk as normal speed', () => {
    expect(clampSpeed(undefined)).toBe(1)
    expect(clampSpeed(Number.NaN)).toBe(1)
    expect(clampSpeed(0.1)).toBe(0.5)
    expect(clampSpeed(9)).toBe(2)
  })

  it('turns speed into Piper length_scale, where larger means slower', () => {
    expect(lengthScale(1)).toBe(1)
    expect(lengthScale(2)).toBe(0.5)
    expect(lengthScale(0.5)).toBe(2)
  })
})
