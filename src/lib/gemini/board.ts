import { decodeEntities, extractMath, normalizeLatex, prepareBoardLine, speakMath } from '@/lib/latex'
import { splitReactions, stripReactions } from '@/lib/voice/reactions'

export interface BoardCard {
  title: string
  body: string
  open: boolean
}

export interface TutorPayload {
  speech: string
  boards: BoardCard[]
}

const COMPLETE =
  /<board(?:\s+title="([^"]*)")?>([\s\S]*?)<\/board>/gi

export function parseTutorPayload(raw: string): TutorPayload {
  const boards: BoardCard[] = []
  let speech = raw

  speech = speech.replace(COMPLETE, (_m, title: string | undefined, body: string) => {
    boards.push({
      title: (title ?? '').trim() || 'Board',
      body: normalizeLatex(body.trim()),
      open: false,
    })
    return '\n'
  })

  const open = /<board(?:\s+title="([^"]*)")?>([\s\S]*)$/i.exec(speech)
  if (open && open.index != null) {
    boards.push({
      title: (open[1] ?? '').trim() || 'Board',
      body: normalizeLatex((open[2] ?? '').trim()),
      open: true,
    })
    speech = speech.slice(0, open.index)
  }

  speech = speech.replace(/<\/?(?:board|say)\b[^>]*>/gi, ' ').trim()

  const pulled = extractMath(speech)
  speech = pulled.prose
  if (pulled.math.length) {
    boards.push({
      title: 'Formulas',
      body: pulled.math.join('\n\n'),
      open: false,
    })
  }

  if (boards.length === 0 && looksLikeBoard(raw)) {
    return {
      speech: '',
      boards: [{ title: 'Board', body: normalizeLatex(stripTags(raw)), open: false }],
    }
  }

  return { speech: speech.trim(), boards }
}

/**
 * One board line per line of the body, so a model that writes one formula per
 * line gets one board line each. A $$...$$ block that spans lines stays whole.
 */
export function boardLines(body: string): string[] {
  const joined = normalizeLatex(body).replace(/\$\$([\s\S]*?)\$\$/g, (block) => block.replace(/\n+/g, ' '))
  return joined
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * The reply as the transcript shows it: the spoken words as prose, and each
 * board as its own display maths. Tags never show. Safe on a reply that is
 * still streaming, where a board may not be closed yet.
 */
export function displayText(raw: string): string {
  const text = decodeEntities(raw)
  const board = /<board(?:\s+title="([^"]*)")?>([\s\S]*?)(<\/board>|$)/gi
  const withBoards = text.replace(board, (_m, title: string | undefined, body: string) => {
    const lines = boardLines(body).map(prepareBoardLine).filter(Boolean)
    const heading = (title ?? '').trim()
    const head = heading ? `**${heading}**\n\n` : ''
    return `\n\n${head}${lines.join('\n\n')}\n\n`
  })
  return withBoards
    .replace(/<\/?say\b[^>]*>/gi, '')
    .replace(/\[(?:laugh|chuckle|sigh|hmm|cough|gasp|groan|yawn|sniffle)\]/gi, ' ')
    .replace(/<\/?board\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function splitBoardBlocks(body: string) {
  return normalizeLatex(body)
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
}

function stripTags(s: string) {
  return s.replace(/<\/?board\b[^>]*>/gi, '').trim()
}

function looksLikeBoard(text: string) {
  const t = stripTags(text)
  const display = (t.match(/\$\$/g) ?? []).length >= 2
  const steps = /(?:^|\n)\s*(?:\d+[\.)]|step\s+\d+)/i.test(t)
  const eq = (t.match(/^\s*.{0,40}=.{0,40}$/gm) ?? []).length >= 3
  return display || (steps && t.includes('$')) || eq
}


/* ---------------- ordered steps ---------------- */

/** One thing the tutor does, in the order it was written. */
export type TutorStep =
  | { kind: 'say'; text: string; spoken: string }
  | { kind: 'board'; title: string; lines: string[]; spokenLines: string[] }

/**
 * Split a reply into ordered steps: speech, then a board, then more speech.
 *
 * Two kinds of text are spoken. A <say> block is written in plain words for the
 * voice, so the model does the reading-aloud. Anything else outside a board is
 * spoken too, through speakMath, which converts any LaTeX it finds. Neither
 * kind can reach the voice as raw symbols or HTML entities.
 *
 * Each step plays in written order, so the voice never stops mid-thought.
 */
export function parseTutorSteps(raw: string): TutorStep[] {
  const steps: TutorStep[] = []
  const text = decodeEntities(raw)

  const clean = (s: string) => s.replace(/<\/?(?:board|say)\b[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim()

  const pushPlain = (plain: string) => {
    const spoken = speakWithReactions(plain)
    if (spoken) steps.push({ kind: 'say', text: stripReactions(plain), spoken })
  }
  // A <say> block is one spoken unit, as the model wrote it.
  const pushSayBlock = (inner: string) => {
    const plain = clean(inner)
    if (plain) pushPlain(plain)
  }
  // Loose text is split into sentences, so each sentence is its own step. That
  // lets a streamed reply be spoken sentence by sentence as it arrives.
  const pushLoose = (chunk: string) => {
    for (const sentence of clean(chunk).split(/(?<=[.!?])\s+/)) {
      if (sentence) pushPlain(sentence)
    }
  }
  const pushText = (chunk: string) => {
    const say = /<say\b[^>]*>([\s\S]*?)(<\/say>|$)/gi
    let last = 0
    let m: RegExpExecArray | null
    while ((m = say.exec(chunk)) !== null) {
      pushLoose(chunk.slice(last, m.index))
      pushSayBlock(m[1] ?? '')
      last = say.lastIndex
      if (m[0].length === 0) say.lastIndex++
    }
    pushLoose(chunk.slice(last))
  }

  const re = /<board(?:\s+title="([^"]*)")?>([\s\S]*?)(<\/board>|$)/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    pushText(text.slice(last, m.index))
    const lines = boardLines(m[2] ?? '').map(prepareBoardLine).filter(Boolean)
    if (lines.length > 0) {
      steps.push({
        kind: 'board',
        title: (m[1] ?? '').trim() || 'Board',
        lines,
        spokenLines: lines.map((l) => speakMath(l)),
      })
    }
    last = re.lastIndex
    if (m[0].length === 0) re.lastIndex++
  }
  pushText(text.slice(last))
  return steps
}

/** Where an open tag starts, if its closing tag has not arrived yet. Otherwise Infinity. */
function openTagAt(text: string, open: RegExp, close: string): number {
  let at = -1
  open.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(text)) !== null) at = m.index
  if (at < 0) return Infinity
  return text.toLowerCase().indexOf(close, at) < 0 ? at : Infinity
}

/**
 * The part of a streaming reply that can no longer change, so it is safe to speak.
 *
 * Held back: an open <board> or <say> and everything after it, a tag still
 * arriving, and the last sentence until a space follows its full stop. Parsing
 * this prefix gives the same steps the finished reply gives, in the same order.
 */
export function stableReplyPrefix(raw: string): string {
  let text = raw
  const partial = /<[^>]*$/.exec(text)
  if (partial) text = text.slice(0, partial.index)
  const cut = Math.min(openTagAt(text, /<board\b/gi, '</board>'), openTagAt(text, /<say\b/gi, '</say>'))
  if (cut !== Infinity) text = text.slice(0, cut)

  let boundary = 0
  const close = /<\/say>|<\/board>/gi
  let m: RegExpExecArray | null
  while ((m = close.exec(text)) !== null) boundary = Math.max(boundary, m.index + m[0].length)
  const sentence = /[.!?](?=\s)/g
  while ((m = sentence.exec(text)) !== null) boundary = Math.max(boundary, m.index + 1)
  return text.slice(0, boundary)
}

/**
 * Speech for a <say> run. Maths is converted to words, but reaction tags such as
 * [sigh] are kept, so the voice can play them.
 */
function speakWithReactions(plain: string): string {
  return splitReactions(plain)
    .map((p) => (p.kind === 'react' ? `[${p.name}]` : speakMath(p.text)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
