import { describe, expect, it } from 'vitest'
import { displayText, parseTutorSteps } from './board'

describe('reaction tags in replies', () => {
  it('keeps the tag for the voice, and hides it from the caption and transcript', () => {
    const raw = '<say>Right, that is the trap. [sigh] Try again.</say>'
    const [step] = parseTutorSteps(raw)
    expect(step?.kind).toBe('say')
    if (step?.kind !== 'say') return
    expect(step.spoken).toContain('[sigh]')
    expect(step.text).not.toContain('[')
    expect(displayText(raw)).not.toContain('[sigh]')
    expect(displayText(raw)).toContain('Try again.')
  })
})
