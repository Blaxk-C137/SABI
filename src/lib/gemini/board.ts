import { extractMath, normalizeLatex, speakMath } from '@/lib/latex'
import { speakable } from './prompt'

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

  speech = speech.replace(/<\/?board\b[^>]*>/gi, '').trim()

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
 * This is what keeps the voice from stopping mid-thought. The old payload
 * pulled all speech out of the reply and spoke it as one block alongside the
 * board, so a board could cut into it. Here the reply plays strictly in the
 * order it was written.
 */
export function parseTutorSteps(raw: string): TutorStep[] {
  const steps: TutorStep[] = []
  const pushSay = (chunk: string) => {
    const text = chunk.replace(/<\/?board\b[^>]*>/gi, ' ').trim()
    if (!text) return
    steps.push({ kind: 'say', text, spoken: speakable(text) })
  }
  const re = /<board(?:\s+title="([^"]*)")?>([\s\S]*?)(<\/board>|$)/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    pushSay(raw.slice(last, m.index))
    const body = normalizeLatex((m[2] ?? '').trim())
    const lines = splitBoardBlocks(body)
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
  pushSay(raw.slice(last))
  return steps
}
