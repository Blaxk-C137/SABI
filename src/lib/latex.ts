/**
 * LaTeX handling for the board (what the student reads) and the voice (what they
 * hear). The board renders math with KaTeX. The voice needs words, so every
 * formula is converted to speech by `latexToSpeech`.
 */

/* ---------------- delimiters and entities ---------------- */

/** Normalize common LaTeX delimiters to $ / $$ so KaTeX + remark-math can render. */
export function normalizeLatex(src: string) {
  return src
    .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, '\n\n$$$$1$$\n\n')
    .replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, '\n\n$$$$1$$\n\n')
    .replace(/\\\[([\s\S]*?)\\\]/g, '\n\n$$$$1$$\n\n')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  times: '×',
  minus: '−',
  middot: '·',
  cdot: '·',
  deg: '°',
  plusmn: '±',
  le: '≤',
  ge: '≥',
  ne: '≠',
  approx: '≈',
  rarr: '→',
  larr: '←',
  infin: '∞',
  delta: 'δ',
  Delta: 'Δ',
  gamma: 'γ',
  Gamma: 'Γ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  Sigma: 'Σ',
  theta: 'θ',
  omega: 'ω',
  Omega: 'Ω',
  rho: 'ρ',
  eta: 'η',
  epsilon: 'ε',
  alpha: 'α',
  beta: 'β',
}

/**
 * Decode HTML entities the model sometimes writes (`&gt;`, `&lt;`, `&amp;`,
 * `&#8594;`). Run before any other processing, so `&gt;` never reaches the board
 * or the voice as text.
 */
export function decodeEntities(src: string): string {
  return src.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

/* ---------------- display: bare LaTeX on a board line ---------------- */

/**
 * True when a board line is maths written without $ delimiters: it has LaTeX
 * commands, sub/superscripts or operators, and almost no English words. Those
 * lines are wrapped in $$ so KaTeX renders them instead of showing raw LaTeX.
 */
export function looksLikeMath(line: string): boolean {
  const t = line.trim()
  if (!t || t.includes('$')) return false
  // Prose inside \text{...} is allowed (units, labels), so strip it before counting words.
  const bare = t.replace(/\\(?:text|mathrm|mathbf|operatorname)\{[^{}]*\}/g, ' ')
  const hasMathSignal = /\\[a-zA-Z]+|[_^=]|[+*/×·−]|(?<=\d)\s*-\s*(?=\d)|\b\d/.test(bare)
  if (!hasMathSignal) return false
  const englishWords = (bare.replace(/\\[a-zA-Z]+/g, ' ').match(/\b[a-zA-Z]{3,}\b/g) ?? []).length
  return englishWords <= 2
}

/** Make one board line display correctly: decode entities, normalize delimiters, wrap bare maths. */
export function prepareBoardLine(line: string): string {
  const decoded = normalizeLatex(decodeEntities(line)).trim()
  if (!decoded) return ''
  return looksLikeMath(decoded) ? `$$${decoded}$$` : decoded
}

/**
 * Extract the math from prose. Used for replies that put formulas inline in the
 * speech and need them moved to the board.
 */
export function extractMath(src: string): { prose: string; math: string[] } {
  const math: string[] = []
  let s = normalizeLatex(decodeEntities(src))

  const pull = (re: RegExp) => {
    s = s.replace(re, (_m, inner: string) => {
      const body = inner.trim()
      if (body) math.push(`$$${body}$$`)
      return '\n'
    })
  }

  pull(/\$\$([\s\S]+?)\$\$/g)
  pull(/(?<!\$)\$([^$\n]+)\$(?!\$)/g)

  const prose = s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return { prose, math }
}

/* ---------------- voice: LaTeX to words ---------------- */

const GREEK: Record<string, string> = {
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  Gamma: 'capital gamma',
  delta: 'delta',
  Delta: 'delta',
  epsilon: 'epsilon',
  varepsilon: 'epsilon',
  zeta: 'zeta',
  eta: 'eta',
  theta: 'theta',
  vartheta: 'theta',
  Theta: 'capital theta',
  iota: 'iota',
  kappa: 'kappa',
  lambda: 'lambda',
  Lambda: 'capital lambda',
  mu: 'mu',
  nu: 'nu',
  xi: 'xi',
  pi: 'pi',
  Pi: 'capital pi',
  rho: 'rho',
  sigma: 'sigma',
  Sigma: 'capital sigma',
  tau: 'tau',
  phi: 'phi',
  varphi: 'phi',
  Phi: 'capital phi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
  Omega: 'capital omega',
}

/** Symbols and operators, as they are said. */
const COMMANDS: Record<string, string> = {
  cdot: ' times ',
  times: ' times ',
  div: ' divided by ',
  pm: ' plus or minus ',
  mp: ' minus or plus ',
  approx: ' approximately equals ',
  sim: ' is about ',
  equiv: ' is equivalent to ',
  neq: ' is not equal to ',
  ne: ' is not equal to ',
  leq: ' is less than or equal to ',
  le: ' is less than or equal to ',
  geq: ' is greater than or equal to ',
  ge: ' is greater than or equal to ',
  ll: ' is much less than ',
  gg: ' is much greater than ',
  rightarrow: ' gives ',
  to: ' gives ',
  Rightarrow: ' therefore ',
  implies: ' therefore ',
  leftarrow: ' comes from ',
  Leftrightarrow: ' if and only if ',
  propto: ' is proportional to ',
  infty: ' infinity ',
  partial: ' partial ',
  nabla: ' nabla ',
  sum: ' the sum of ',
  prod: ' the product of ',
  int: ' the integral of ',
  lim: ' the limit of ',
  sin: ' sine ',
  cos: ' cosine ',
  tan: ' tangent ',
  ln: ' natural log of ',
  log: ' log of ',
  exp: ' e to the power of ',
  deg: ' degrees ',
  circ: ' degrees ',
  ldots: ' and so on ',
  dots: ' and so on ',
  cdots: ' and so on ',
  '%': ' percent ',
  '&': ' and ',
  '#': ' number ',
  '{': '',
  '}': '',
  ',': ', ',
  ';': ', ',
  ':': ', ',
  '!': '',
  ' ': ' ',
  quad: ' ',
  qquad: ' ',
  left: '',
  right: '',
  bigl: '',
  bigr: '',
  big: '',
  Big: '',
  displaystyle: '',
}

/** Units written inside \text{}, said as words. */
const UNITS: Record<string, string> = {
  J: 'joules',
  kJ: 'kilojoules',
  kg: 'kilogram',
  g: 'gram',
  K: 'kelvin',
  m: 'metres',
  cm: 'centimetres',
  s: 'seconds',
  N: 'newtons',
  kN: 'kilonewtons',
  W: 'watts',
  kW: 'kilowatts',
  Pa: 'pascals',
  kPa: 'kilopascals',
  bar: 'bar',
  atm: 'atmospheres',
  mol: 'moles',
  V: 'volts',
  A: 'amps',
  Hz: 'hertz',
  C: 'degrees Celsius',
}

/**
 * Words written in \text{}. A unit such as "J/(kg·K)" becomes "joules per
 * kilogram kelvin"; any other text is read as written, with units expanded.
 */
function speakText(inner: string): string {
  const words = (part: string) =>
    part
      .replace(/[()·]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => UNITS[w] ?? w)
      .join(' ')
  if (!inner.includes('/')) return words(inner)
  const slash = inner.indexOf('/')
  const top = words(inner.slice(0, slash))
  const bottom = words(inner.slice(slash + 1))
  return [top, 'per', bottom].filter(Boolean).join(' ')
}

/**
 * Turn one LaTeX fragment into words. Handles fractions, roots, sub- and
 * superscripts, \text units, Greek letters, and the usual operators. Groups are
 * read recursively, so nested fractions and powers come out in order.
 */
export function latexToSpeech(src: string): string {
  return cleanSpeech(readTokens(src))
}

function readTokens(src: string): string {
  let out = ''
  let i = 0
  const s = src

  const readGroup = (): string => {
    // s[i] is '{' — read to its matching '}'.
    if (s[i] !== '{') {
      const one = s[i] ?? ''
      i++
      return readSimple(one)
    }
    let depth = 0
    const start = i + 1
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const inner = s.slice(start, i)
    i++ // skip the closing brace
    return readTokens(inner)
  }

  const readSimple = (ch: string): string => {
    if (ch === '\\') return readCommand()
    return ch
  }

  const readCommand = (): string => {
    // s[i] is '\\' — read the command name, or a single symbol like \, or \%.
    i++
    const m = /^[a-zA-Z]+/.exec(s.slice(i))
    if (!m) {
      const sym = s[i] ?? ''
      i++
      return COMMANDS[sym] ?? ' '
    }
    const name = m[0]
    i += name.length
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac': {
        const num = readGroup()
        const den = readGroup()
        return ` ${num.trim()}, over, ${den.trim()} `
      }
      case 'sqrt': {
        let index = ''
        if (s[i] === '[') {
          const end = s.indexOf(']', i)
          index = s.slice(i + 1, end)
          i = end + 1
        }
        const body = readGroup()
        return index ? ` the ${index} root of ${body.trim()} ` : ` square root of ${body.trim()} `
      }
      case 'text':
      case 'mathrm':
      case 'mathbf':
      case 'operatorname':
      case 'textbf':
      case 'mathit': {
        const raw = readRawGroup()
        return name === 'text' || name === 'textbf' ? speakText(raw) : readTokens(raw)
      }
      case 'hat':
      case 'bar':
      case 'vec':
      case 'dot':
      case 'tilde':
      case 'overline':
      case 'underline':
        return readGroup()
      default:
        if (GREEK[name]) return ` ${GREEK[name]} `
        if (COMMANDS[name] !== undefined) return COMMANDS[name]
        return ` ${name} `
    }
  }

  /** Read a group as raw text, without converting it (used for \text). */
  const readRawGroup = (): string => {
    if (s[i] !== '{') {
      const one = s[i] ?? ''
      i++
      return one
    }
    let depth = 0
    const start = i + 1
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const inner = s.slice(start, i)
    i++
    return inner
  }

  /** Sub- and superscripts take the next group or single character. */
  const readScript = (kind: '_' | '^') => {
    const body = readGroup().trim()
    if (kind === '_') return ` sub ${body} `
    if (body === '2') return ' squared '
    if (body === '3') return ' cubed '
    if (body === '-1') return ' inverse '
    return ` to the power of ${body} `
  }

  while (i < s.length) {
    const ch = s[i]!
    if (ch === '\\') {
      out += readCommand()
    } else if (ch === '_' || ch === '^') {
      i++
      out += readScript(ch)
    } else if (ch === '{' || ch === '}') {
      i++
    } else if (ch === '=') {
      out += ' equals '
      i++
    } else if (ch === '+') {
      out += ' plus '
      i++
    } else if (ch === '−' || ch === '-') {
      out += ' minus '
      i++
    } else if (ch === '*' || ch === '·' || ch === '×') {
      out += ' times '
      i++
    } else if (ch === '/') {
      out += ' over '
      i++
    } else if (ch === '<') {
      out += ' less than '
      i++
    } else if (ch === '>') {
      out += ' greater than '
      i++
    } else if (ch === '≈') {
      out += ' approximately equals '
      i++
    } else if (ch === '≤') {
      out += ' less than or equal to '
      i++
    } else if (ch === '≥') {
      out += ' greater than or equal to '
      i++
    } else if (ch === '≠') {
      out += ' not equal to '
      i++
    } else if (ch === '±') {
      out += ' plus or minus '
      i++
    } else if (ch === '→') {
      out += ' gives '
      i++
    } else if (ch === '°') {
      out += ' degrees '
      i++
    } else if (ch === '%') {
      out += ' percent '
      i++
    } else if (ch === '&') {
      out += ' and '
      i++
    } else if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
      out += ' '
      i++
    } else {
      out += ch
      i++
    }
  }
  return out
}

/** Tidy the spoken string: no stray symbols, no doubled spaces, no space before commas. */
function cleanSpeech(s: string): string {
  return s
    .replace(/\\/g, ' ')
    .replace(/[$`*#_~|]/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*(?=\.|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Prose plus spoken formulas. Used when the reply has formulas outside $ delimiters. */
export function speakMath(src: string) {
  let s = normalizeLatex(decodeEntities(src))
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => ` ${latexToSpeech(inner)}. `)
  s = s.replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (_m, inner: string) => ` ${latexToSpeech(inner)} `)
  return cleanSpeech(speakProseSymbols(s))
}

/**
 * Symbols that appear in ordinary sentences, not inside maths: "T > 0", "a & b".
 * They are said as words. Hyphens are left alone, so "well-known" stays one word.
 */
export function speakProseSymbols(s: string): string {
  return s
    .replace(/>=|≥/g, ' greater than or equal to ')
    .replace(/<=|≤/g, ' less than or equal to ')
    .replace(/≠/g, ' not equal to ')
    .replace(/≈/g, ' approximately equals ')
    .replace(/→/g, ' gives ')
    .replace(/×/g, ' times ')
    .replace(/−/g, ' minus ')
    .replace(/±/g, ' plus or minus ')
    .replace(/>/g, ' greater than ')
    .replace(/</g, ' less than ')
    .replace(/&/g, ' and ')
    .replace(/=/g, ' equals ')
    .replace(/(?<=\s)\+(?=\s)/g, ' plus ')
}
