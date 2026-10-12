import { describe, expect, it } from 'vitest'
import { parseTutorSteps, stableReplyPrefix } from '@/lib/gemini/board'
import { createStepQueue, playReply, type PlayHooks } from './reply-player'

const REPLY =
  'Good. <say>Start with the first law.</say> Heat in raises U. ' +
  '<board title="Work">\n$$\\Delta U = Q - W$$\n$$Q = 5$$\n</board>\n' +
  '<say>So U rises by five joules. What does W equal?</say>'

/** Feed the reply one character at a time, as a stream would arrive. */
function streamed(text: string): string[] {
  const out: string[] = []
  for (let i = 1; i <= text.length; i++) out.push(text.slice(0, i))
  return out
}

describe('stableReplyPrefix', () => {
  it('holds back an open say block and a half-written board', () => {
    expect(stableReplyPrefix('Look. <say>Start with')).toBe('Look.')
    expect(stableReplyPrefix('<board title="X">\n$$a =')).toBe('')
  })

  it('holds back the last sentence until a space follows its full stop', () => {
    expect(stableReplyPrefix('Heat in.')).toBe('')
    expect(stableReplyPrefix('Heat in. Next')).toBe('Heat in.')
  })

  it('does not hold back a partly-streamed tag as text', () => {
    expect(stableReplyPrefix('Done. <bo')).toBe('Done.')
  })
})

describe('streaming a reply', () => {
  const finalSteps = parseTutorSteps(REPLY)

  it('every stable prefix parses to the start of the final steps', () => {
    for (const partial of streamed(REPLY)) {
      const steps = parseTutorSteps(stableReplyPrefix(partial))
      expect(JSON.stringify(steps)).toBe(JSON.stringify(finalSteps.slice(0, steps.length)))
    }
  })

  it('the full stream ends with every step', () => {
    const last = streamed(REPLY).at(-1)!
    expect(parseTutorSteps(last)).toEqual(finalSteps)
  })

  it('speaks the first sentence before the rest of the reply has arrived', () => {
    const early = parseTutorSteps(stableReplyPrefix('<say>Start with the first law.</say> Heat'))
    expect(early.length).toBeGreaterThan(0)
    expect(early[0]?.kind === 'say' && early[0].spoken).toBe('Start with the first law.')
  })
})

describe('createStepQueue', () => {
  it('plays steps as they are pushed, and ends when closed', async () => {
    const queue = createStepQueue()
    const spoken: string[] = []
    const hooks: PlayHooks = {
      speak: async (t) => {
        spoken.push(t)
      },
      pause: async () => undefined,
      cancelled: () => false,
      onStep: () => undefined,
      onLine: () => undefined,
      onCaption: () => undefined,
    }
    const done = playReply(queue.steps, hooks)
    queue.push({ kind: 'say', text: 'One.', spoken: 'One.' })
    await new Promise((r) => setTimeout(r, 5))
    queue.push({ kind: 'say', text: 'Two.', spoken: 'Two.' })
    queue.close()
    await done
    expect(spoken).toEqual(['One.', 'Two.'])
  })

  it('a closed empty queue finishes at once', async () => {
    const queue = createStepQueue()
    queue.close()
    await expect(
      playReply(queue.steps, {
        speak: async () => undefined,
        pause: async () => undefined,
        cancelled: () => false,
        onStep: () => undefined,
        onLine: () => undefined,
        onCaption: () => undefined,
      }),
    ).resolves.toBeUndefined()
  })
})
