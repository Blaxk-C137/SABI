import { describe, expect, it } from 'vitest'
import { decodeEntities, latexToSpeech, looksLikeMath, prepareBoardLine, speakMath } from './latex'

// The lines from the board the student reported, as the model wrote them.
const CP = String.raw`c_p = c_v + R = 716 + 287 = 1003 \text{ J/(kg}\cdot\text{K)}`
const GAMMA = String.raw`\gamma = \frac{c_p}{c_v} = \frac{1003}{716} \approx 1.4008`
const RATIO = String.raw`\frac{T_2}{T_1} = \left(\frac{P_2}{P_1}\right)^{\frac{\gamma - 1}{\gamma}}`
const T2 = String.raw`T_2 = 283 \cdot (6)^{\frac{1.4008 - 1}{1.4008}}`

describe('latexToSpeech', () => {
  it('reads subscripts, units and operators as words', () => {
    const said = latexToSpeech(CP)
    expect(said).toBe(
      'c sub p equals c sub v plus R equals 716 plus 287 equals 1003 joules per kilogram times kelvin',
    )
  })

  it('reads fractions, approximations and Greek letters', () => {
    const said = latexToSpeech(GAMMA)
    expect(said).toContain('gamma equals c sub p, over, c sub v')
    expect(said).toContain('approximately equals 1.4008')
    expect(said).not.toMatch(/[\\{}^_$]/)
  })

  it('reads the power law without raw tokens', () => {
    const said = latexToSpeech(RATIO)
    expect(said).toContain('T sub 2, over, T sub 1 equals')
    expect(said).toContain('to the power of')
    expect(said).toContain('gamma minus 1')
    expect(said).not.toMatch(/[\\{}^_]/)
  })

  it('reads a product with a power', () => {
    expect(latexToSpeech(T2)).toBe('T sub 2 equals 283 times 6 to the power of 1.4008 minus 1, over, 1.4008')
  })

  it('reads squares and cubes naturally', () => {
    expect(latexToSpeech('E = m c^2')).toBe('E equals m c squared')
    expect(latexToSpeech('V^3')).toBe('V cubed')
  })

  it('reads an integral sign and a sum', () => {
    expect(latexToSpeech(String.raw`\sum_{i=1}^{n} x_i`)).toContain('the sum of')
  })
})

describe('decodeEntities', () => {
  it('turns HTML entities back into symbols', () => {
    expect(decodeEntities('T &gt; 0 &amp;&amp; P &lt; 5 &times; 10')).toBe('T > 0 && P < 5 × 10')
    expect(decodeEntities('&#8594; &#x3b4;')).toBe('→ δ')
  })
})

describe('board display', () => {
  it('wraps bare LaTeX lines so they render, not print raw', () => {
    expect(looksLikeMath(CP)).toBe(true)
    expect(prepareBoardLine(GAMMA)).toBe(`$$${GAMMA}$$`)
    expect(prepareBoardLine(RATIO)).toBe(`$$${RATIO}$$`)
  })

  it('leaves prose and already-delimited maths alone', () => {
    expect(looksLikeMath('Heat in raises the internal energy.')).toBe(false)
    expect(prepareBoardLine('$\\Delta U = Q - W$')).toBe('$\\Delta U = Q - W$')
    expect(prepareBoardLine('Where $c_p$ is the specific heat at constant pressure.')).toBe(
      'Where $c_p$ is the specific heat at constant pressure.',
    )
  })

  it('decodes entities before deciding a line is maths', () => {
    expect(prepareBoardLine('x &gt; 0')).toBe('$$x > 0$$')
  })
})

describe('speakMath', () => {
  it('speaks delimited formulas inside a sentence', () => {
    expect(speakMath('Then $\\Delta U = Q - W$ holds.')).toBe('Then delta U equals Q minus W holds.')
  })
})
