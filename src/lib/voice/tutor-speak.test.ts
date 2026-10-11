import { describe, expect, it } from 'vitest'
import { chunkSpeech } from './tutor-speak'

describe('chunkSpeech', () => {
  it('returns nothing for blank text', () => {
    expect(chunkSpeech('   ')).toEqual([])
  })

  it('keeps a short reply in one clip', () => {
    expect(chunkSpeech('Delta U equals Q minus W.')).toEqual(['Delta U equals Q minus W.'])
  })

  it('never produces a clip longer than the limit', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here, and it goes on`).join('. ')
    for (const c of chunkSpeech(long, 120)) expect(c.length).toBeLessThanOrEqual(120)
  })

  it('splits a single unbroken run of words rather than dropping any', () => {
    const word = 'a'.repeat(50)
    const text = Array.from({ length: 10 }, () => word).join(' ')
    const out = chunkSpeech(text, 100)
    expect(out.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
    for (const c of out) expect(c.length).toBeLessThanOrEqual(100)
  })

  it('keeps every word, in order, across the split', () => {
    const text = 'The first law says energy is conserved. Heat added raises internal energy, and work is done by the system. So delta U equals Q minus W.'
    const out = chunkSpeech(text, 60)
    expect(out.join(' ')).toBe(text)
  })
})
