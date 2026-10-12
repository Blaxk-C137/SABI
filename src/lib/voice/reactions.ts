/**
 * Human reactions the tutor can make: a laugh, a sigh, a cough. The tutor writes
 * them as tags inside <say>, for example "Right, that's the trap. [sigh] Let's
 * try again." The tags are never read aloud or shown as text. Each tag plays a
 * recorded clip from public/reactions/, if one exists for it.
 */

/** Every tag the tutor may write. */
export const REACTION_NAMES = [
  'laugh',
  'chuckle',
  'sigh',
  'hmm',
  'cough',
  'gasp',
  'groan',
  'yawn',
  'sniffle',
] as const

export type ReactionName = (typeof REACTION_NAMES)[number]

const TAG = new RegExp(`\\[(${REACTION_NAMES.join('|')})\\]`, 'gi')

export type ReactionPiece = { kind: 'text'; text: string } | { kind: 'react'; name: string }

/** Split text at reaction tags, keeping the text in between. Unknown brackets stay as text. */
export function splitReactions(text: string): ReactionPiece[] {
  const out: ReactionPiece[] = []
  let last = 0
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    out.push({ kind: 'react', name: m[1]!.toLowerCase() })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/** Remove reaction tags for the transcript and captions. Spacing is tidied. */
export function stripReactions(text: string): string {
  return text
    .replace(TAG, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pick one clip for a reaction from the manifest, or null when none is recorded. */
export function pickReaction(
  manifest: Record<string, string[]>,
  name: string,
  rng: () => number = Math.random,
): string | null {
  const files = manifest[name]
  if (!files || files.length === 0) return null
  return files[Math.floor(rng() * files.length)] ?? null
}
