/** Normalize common LaTeX delimiters to $ / $$ so KaTeX + remark-math can render. */
export function normalizeLatex(src: string) {
  return src
    .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, '\n\n$$$$1$$\n\n')
    .replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, '\n\n$$$$1$$\n\n')
    .replace(/\\\[([\s\S]*?)\\\]/g, '\n\n$$$$1$$\n\n')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
}

export function extractMath(src: string): { prose: string; math: string[] } {
  const math: string[] = []
  let s = normalizeLatex(src)

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
  Phi: 'capital phi',
  varphi: 'phi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
  Omega: 'capital omega',
}

/** Turn LaTeX into something a lecturer would say. */
export function latexToSpeech(src: string) {
  let s = src.trim()
  s = s.replace(/\\left|\\right/g, '')
  s = s.replace(/\\,|\\;|\\!|\\quad|\\qquad/g, ' ')
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 over $2 ')
  s = s.replace(/\\dfrac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 over $2 ')
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, ' square root of $1 ')
  s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, ' $2 to the 1 over $1 ')
  s = s.replace(/\\sum/g, ' sum ')
  s = s.replace(/\\prod/g, ' product ')
  s = s.replace(/\\int/g, ' integral ')
  s = s.replace(/\\lim/g, ' limit ')
  s = s.replace(/\\infty/g, ' infinity ')
  s = s.replace(/\\partial/g, ' partial ')
  s = s.replace(/\\nabla/g, ' nabla ')
  s = s.replace(/\\cdot|\\times/g, ' times ')
  s = s.replace(/\\div/g, ' divided by ')
  s = s.replace(/\\pm/g, ' plus or minus ')
  s = s.replace(/\\mp/g, ' minus or plus ')
  s = s.replace(/\\leq|\\le/g, ' less than or equal to ')
  s = s.replace(/\\geq|\\ge/g, ' greater than or equal to ')
  s = s.replace(/\\neq|\\ne/g, ' not equal to ')
  s = s.replace(/\\approx/g, ' approximately ')
  s = s.replace(/\\equiv/g, ' equivalent to ')
  s = s.replace(/\\rightarrow|\\to/g, ' goes to ')
  s = s.replace(/\\leftarrow/g, ' from ')
  s = s.replace(/\\sin/g, ' sine ')
  s = s.replace(/\\cos/g, ' cosine ')
  s = s.replace(/\\tan/g, ' tan ')
  s = s.replace(/\\ln/g, ' natural log ')
  s = s.replace(/\\log/g, ' log ')
  s = s.replace(/\\exp/g, ' e to the ')
  s = s.replace(/\\mathrm\{([^{}]+)\}/g, '$1')
  s = s.replace(/\\text\{([^{}]+)\}/g, '$1')
  s = s.replace(/\\operatorname\{([^{}]+)\}/g, '$1')
  for (const [k, v] of Object.entries(GREEK)) {
    s = s.replace(new RegExp(`\\\\${k}\\b`, 'g'), ` ${v} `)
  }
  s = s.replace(/\^\{?2\}?/g, ' squared ')
  s = s.replace(/\^\{?3\}?/g, ' cubed ')
  s = s.replace(/\^\{([^}]+)\}/g, ' to the $1 ')
  s = s.replace(/\^([A-Za-z0-9])/g, ' to the $1 ')
  s = s.replace(/_\{([^}]+)\}/g, ' $1 ')
  s = s.replace(/_([A-Za-z0-9])/g, ' $1 ')
  s = s.replace(/[=]/g, ' equals ')
  s = s.replace(/[+]/g, ' plus ')
  s = s.replace(/(?<![A-Za-z])-(?!-)/g, ' minus ')
  s = s.replace(/[/]/g, ' over ')
  s = s.replace(/[()[\]{}\\]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/** Prose plus spoken formulas — used while the lecturer writes. */
export function speakMath(src: string) {
  let s = normalizeLatex(src)
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => ` ${latexToSpeech(inner)} `)
  s = s.replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (_m, inner: string) => ` ${latexToSpeech(inner)} `)
  s = s.replace(/[#*_>~`]/g, '')
  return s.replace(/\s+/g, ' ').trim()
}

