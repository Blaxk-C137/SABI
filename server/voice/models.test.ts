import { describe, expect, it } from 'vitest'
import { ASR_MODELS, DEFAULT_ASR_MODEL, isAsrModel, resolveAsrModel } from './models.ts'

describe('ASR_MODELS', () => {
  it('pins Whisper small as the default, and it is a real entry', () => {
    expect(DEFAULT_ASR_MODEL).toBe('Xenova/whisper-small')
    expect(ASR_MODELS.map((m) => m.id)).toContain(DEFAULT_ASR_MODEL)
  })

  it('offers a faster alternative', () => {
    expect(ASR_MODELS.length).toBeGreaterThan(1)
  })
})

describe('isAsrModel', () => {
  it('accepts a listed model', () => {
    expect(isAsrModel('Xenova/whisper-base')).toBe(true)
  })

  it('rejects anything else, so an unvetted id never reaches the downloader', () => {
    expect(isAsrModel('Xenova/whisper-large-v3')).toBe(false)
    expect(isAsrModel('../../etc/passwd')).toBe(false)
    expect(isAsrModel('')).toBe(false)
  })
})

describe('resolveAsrModel', () => {
  it('passes a listed model through', () => {
    expect(resolveAsrModel('Xenova/whisper-base')).toBe('Xenova/whisper-base')
  })

  it('falls back to the default when the setting is absent or empty', () => {
    expect(resolveAsrModel(undefined)).toBe(DEFAULT_ASR_MODEL)
    expect(resolveAsrModel(null)).toBe(DEFAULT_ASR_MODEL)
    expect(resolveAsrModel('')).toBe(DEFAULT_ASR_MODEL)
  })

  it('falls back to the default rather than loading an unlisted model', () => {
    expect(resolveAsrModel('Xenova/whisper-large-v3')).toBe(DEFAULT_ASR_MODEL)
  })
})

