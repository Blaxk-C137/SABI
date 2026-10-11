import { describe, expect, it } from 'vitest'
import { parseTutorSteps } from '@/lib/gemini/board'
import { playReply, type PlayHooks } from './reply-player'

function recorder(opts: { cancelAfter?: number } = {}) {
  const log: string[] = []
  let cancelled = false
  let spoken = 0
  const hooks: PlayHooks = {
    speak: async (t) => {
      log.push(`speak:${t}`)
      spoken++
      if (opts.cancelAfter !== undefined && spoken >= opts.cancelAfter) cancelled = true
    },
    pause: async (ms) => {
      log.push(`pause:${ms}`)
    },
    cancelled: () => cancelled,
    onStep: (i, s) => log.push(`step:${i}:${s.kind}`),
    onLine: (i, shown) => log.push(`line:${i}:${shown}`),
    onCaption: () => undefined,
  }
  return { hooks, log }
}

describe('playReply', () => {
  it('speaks the lead-in fully before the board, and the board before the close', async () => {
    const raw = 'First, the first law. <board title="Work">\nΔU = Q − W\n\nQ = 5 J\n</board> Now your turn.'
    const { hooks, log } = recorder()
    await playReply(parseTutorSteps(raw), hooks)
    const speaks = log.filter((l) => l.startsWith('speak:'))
    expect(speaks[0]).toContain('First, the first law.')
    expect(log.indexOf('step:1:board')).toBeGreaterThan(log.findIndex((l) => l.startsWith('speak:First')))
    expect(speaks.at(-1)).toContain('Now your turn.')
    expect(log.indexOf('line:1:2')).toBeGreaterThan(log.indexOf('line:1:1'))
  })

  it('stops immediately when cancelled, and never reaches later steps', async () => {
    const raw = 'One. <board>\nA\n\nB\n</board> Two.'
    const { hooks, log } = recorder({ cancelAfter: 1 })
    await playReply(parseTutorSteps(raw), hooks)
    expect(log.some((l) => l.includes('Two.'))).toBe(false)
    expect(log.filter((l) => l.startsWith('line:')).length).toBe(0)
  })

  it('uses timed pauses for board lines with nothing to speak', async () => {
    const { hooks, log } = recorder()
    await playReply(
      [{ kind: 'board', title: 'B', lines: ['x = 1'], spokenLines: [''] }],
      hooks,
    )
    expect(log.some((l) => l.startsWith('pause:'))).toBe(true)
    expect(log.some((l) => l.startsWith('speak:'))).toBe(false)
  })
})

describe('parseTutorSteps', () => {
  it('keeps the written order of speech and boards', () => {
    const steps = parseTutorSteps('A. <board title="T">\nx = 1\n</board> B. <board>\ny = 2\n</board> C.')
    expect(steps.map((s) => s.kind)).toEqual(['say', 'board', 'say', 'board', 'say'])
  })

  it('treats an unclosed board as a board that is still being written', () => {
    const steps = parseTutorSteps('Set up: <board title="Live">\nx = 1\n\ny = ')
    expect(steps.at(-1)).toMatchObject({ kind: 'board', title: 'Live' })
  })

  it('returns no steps for an empty reply', () => {
    expect(parseTutorSteps('   ')).toEqual([])
  })
})
