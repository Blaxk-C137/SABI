import { describe, expect, it } from 'vitest'
import { boardLines, displayText, parseTutorPayload, parseTutorSteps } from './board'
import { clipGapMs } from '@/lib/voice/tutor-speak'

const REPLY = `<say>Start with the specific heats. The constant pressure value is the constant volume value plus R.</say>
<board title="Specific heats">
$$c_p = c_v + R = 716 + 287 = 1003 \\text{ J/(kg}\\cdot\\text{K)}$$
$$\\gamma = \\frac{c_p}{c_v} = \\frac{1003}{716} \\approx 1.4008$$
</board>
<say>So gamma is about one point four. Now the temperature ratio.</say>
<board title="Isentropic">
\\frac{T_2}{T_1} = \\left(\\frac{P_2}{P_1}\\right)^{\\frac{\\gamma - 1}{\\gamma}}
T_2 = 283 \\cdot (6)^{\\frac{1.4008 - 1}{1.4008}}
</board>
<say>Then the answer is the one the student should check against the notes.</say>`

describe('parseTutorSteps', () => {
  const steps = parseTutorSteps(REPLY)

  it('plays speech and board in the order written', () => {
    expect(steps.map((s) => s.kind)).toEqual(['say', 'board', 'say', 'board', 'say'])
  })

  it('never speaks LaTeX or entities', () => {
    for (const step of steps) {
      const spoken = step.kind === 'say' ? [step.spoken] : step.spokenLines
      for (const text of spoken) {
        expect(text).not.toMatch(/[\\$^_{}]|&gt;|&lt;|&amp;/)
      }
    }
  })

  it('reads the board formulas in words', () => {
    const board = steps[1]
    expect(board?.kind).toBe('board')
    if (board?.kind !== 'board') return
    expect(board.spokenLines[0]).toBe('c sub p equals c sub v plus R equals 716 plus 287 equals 1003 joules per kilogram times kelvin.')
    expect(board.spokenLines[1]).toContain('approximately equals 1.4008')
  })

  it('displays every board line as delimited maths, so KaTeX renders it', () => {
    const board = steps[3]
    expect(board?.kind).toBe('board')
    if (board?.kind !== 'board') return
    expect(board.lines).toHaveLength(2)
    for (const line of board.lines) {
      expect(line.startsWith('$$') && line.endsWith('$$')).toBe(true)
    }
  })

  it('keeps each spoken sentence block as its own step', () => {
    const say = steps[0]
    expect(say?.kind === 'say' && say.text).toBe(
      'Start with the specific heats. The constant pressure value is the constant volume value plus R.',
    )
  })

  it('speaks an entity written in prose as the symbol it stands for', () => {
    const [step] = parseTutorSteps('<say>Check that T &gt; 0 holds.</say>')
    expect(step?.kind === 'say' && step.spoken).toBe('Check that T greater than 0 holds.')
  })

  it('still speaks loose prose with inline LaTeX', () => {
    const [step] = parseTutorSteps('Then $\\Delta U = Q - W$ follows.')
    expect(step?.kind === 'say' && step.spoken).toBe('Then delta U equals Q minus W follows.')
  })
})

describe('boardLines', () => {
  it('gives one board line per line, and keeps a multi-line $$ block whole', () => {
    expect(boardLines('a = 1\nb = 2')).toEqual(['a = 1', 'b = 2'])
    expect(boardLines('$$\nx = 1\n$$\nNext line')).toEqual(['$$ x = 1 $$', 'Next line'])
  })
})

describe('clipGapMs', () => {
  it('pauses longest after a full stop, shorter after a comma', () => {
    expect(clipGapMs('It is done.')).toBeGreaterThan(clipGapMs('Given the heat,'))
    expect(clipGapMs('Given the heat,')).toBeGreaterThan(0)
    expect(clipGapMs('Is it?')).toBe(clipGapMs('It is done.'))
  })
})

describe('displayText', () => {
  it('shows no tags, keeps the words, and delimits board maths', () => {
    const shown = displayText('<say>Heat in.</say>\n<board title="Step">\n\\Delta U = Q - W\n</board>\n<say>Next.</say>')
    expect(shown).not.toMatch(/<\/?(say|board)/)
    expect(shown).toContain('Heat in.')
    expect(shown).toContain('$$\\Delta U = Q - W$$')
    expect(shown).toContain('Next.')
  })

  it('handles a board that is still streaming', () => {
    const shown = displayText('<say>Look.</say><board title="Live">\\frac{a}{b}')
    expect(shown).toContain('$$\\frac{a}{b}$$')
    expect(shown).not.toContain('<board')
  })
})

describe('parseTutorPayload caption', () => {
  it('does not show the say tags as caption text', () => {
    const payload = parseTutorPayload('<say>Look at this.</say><board title="B">$$x$$</board>')
    expect(payload.speech).not.toMatch(/<\/?say/)
    expect(payload.speech).toContain('Look at this.')
  })
})
