import { describe, expect, it } from 'vitest'
import { CHECK_INS, MARKERS, makeBreath, newNaturalState, planSpeech, speedJitter } from './natural'

const never = () => 0.99 // no markers, no breaths
const always = () => 0 // markers on, first marker ('Right,')

const words = (n: number) => `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}.`

/** Strip any opening marker from speech, to compare the words themselves. */
function stripMarker(text: string): string {
  for (const m of MARKERS) {
    if (text.startsWith(`${m} `)) return text.slice(m.length + 1)
  }
  return text
}

describe('planSpeech', () => {
  it('adds a breath once enough words have been spoken', () => {
    const state = newNaturalState(() => 0) // breakAt = 16
    // The breath is checked before a sentence, so 20 words in one sentence gives none yet.
    expect(planSpeech(words(20), 'say', state, never).map((p) => p.kind)).toEqual(['speech'])
    expect(planSpeech(words(3), 'say', state, never)[0]).toEqual({ kind: 'breath' })
  })

  it('does not breathe before a short first sentence', () => {
    const state = newNaturalState(never)
    expect(planSpeech('Delta U equals Q minus W.', 'say', state, never)).toEqual([
      { kind: 'speech', text: 'Delta U equals Q minus W.' },
    ])
  })

  it('breathes before the first sentence after a board', () => {
    const state = newNaturalState(never)
    planSpeech('$$x=1$$', 'line', state, never)
    expect(planSpeech('So that is the result.', 'say', state, always)[0]).toEqual({ kind: 'breath' })
  })

  it('never adds markers to board lines', () => {
    const state = newNaturalState(never)
    const line = 'T sub 2 over T sub 1 equals V sub 2 over V sub 1.'
    expect(planSpeech(line, 'line', state, always)).toEqual([{ kind: 'speech', text: line }])
  })

  it('adds a marker, lowercases the next word, and keeps symbols intact', () => {
    const state = newNaturalState(never)
    expect(planSpeech('Heat at constant volume goes into internal energy.', 'say', state, always)[0]).toEqual({
      kind: 'speech',
      text: 'Right, heat at constant volume goes into internal energy.',
    })
    const state2 = newNaturalState(never)
    expect(planSpeech('T sub 2 is higher.', 'say', state2, always)[0]).toEqual({
      kind: 'speech',
      text: 'Right, T sub 2 is higher.',
    })
  })

  it('never puts two markers in a row', () => {
    const state = newNaturalState(never)
    const parts = planSpeech('One. Two. Three. Four.', 'say', state, always)
    const speech = parts.flatMap((p) => (p.kind === 'speech' ? [p.text] : []))
    const marked = speech.filter((t) => MARKERS.some((m) => t.startsWith(`${m} `)))
    expect(marked.length).toBeLessThan(speech.length)
    speech.forEach((t, i) => {
      if (i > 0 && MARKERS.some((m) => speech[i - 1]!.startsWith(`${m} `))) {
        expect(MARKERS.some((m) => t.startsWith(`${m} `))).toBe(false)
      }
    })
  })

  it('draws markers from the whole list, not just one', () => {
    const seen = new Set<string>()
    for (let k = 0; k < 200; k++) {
      const parts = planSpeech('Hello there.', 'say', newNaturalState(() => 0.5), () => (k % 9) / 9)
      for (const p of parts) {
        if (p.kind === 'speech') {
          const m = MARKERS.find((x) => p.text.startsWith(`${x} `))
          if (m) seen.add(m)
        }
      }
    }
    expect(seen.size).toBeGreaterThan(3)
  })

  it('keeps every spoken word, and only adds markers and breaths', () => {
    const state = newNaturalState(() => 0.5)
    const text = `${words(12)} ${words(12)} ${words(12)}`
    const parts = planSpeech(text, 'say', state, () => 0.5)
    const spoken = parts
      .flatMap((p) => (p.kind === 'speech' ? [stripMarker(p.text)] : []))
      .join(' ')
      .toLowerCase()
    expect(spoken.replace(/\s+/g, ' ')).toBe(text.toLowerCase())
  })

  it('ships a set of natural check-ins, including the ones the student asked for', () => {
    expect(CHECK_INS).toEqual(expect.arrayContaining(['Do you understand?', 'Are you following?', 'Aight, bet?']))
  })
})

describe('speedJitter', () => {
  it('stays within about four percent of the base speed', () => {
    for (const r of [0, 0.25, 0.5, 0.99]) {
      const s = speedJitter(1, () => r)
      expect(s).toBeGreaterThanOrEqual(0.96)
      expect(s).toBeLessThan(1.04)
    }
  })
})

describe('makeBreath', () => {
  it('returns quiet, finite samples of the requested length', () => {
    const b = makeBreath(22050, 0.8, () => 0.3)
    expect(b.length).toBe(Math.floor(22050 * 0.8))
    let peak = 0
    for (const x of b) {
      expect(Number.isFinite(x)).toBe(true)
      peak = Math.max(peak, Math.abs(x))
    }
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(0.3)
  })

  it('fades in and out, so it does not click', () => {
    const b = makeBreath(22050, 0.8, () => 0.3)
    expect(Math.abs(b[0]!)).toBeLessThan(1e-3)
    expect(Math.abs(b[b.length - 1]!)).toBeLessThan(1e-3)
  })
})
