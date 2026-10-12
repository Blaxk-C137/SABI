import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pickReaction, REACTION_NAMES, splitReactions, stripReactions } from './reactions'

describe('splitReactions', () => {
  it('splits text at reaction tags and keeps the words around them', () => {
    expect(splitReactions('Right, that is the trap. [sigh] Try again.')).toEqual([
      { kind: 'text', text: 'Right, that is the trap. ' },
      { kind: 'react', name: 'sigh' },
      { kind: 'text', text: ' Try again.' },
    ])
  })

  it('handles a tag at the very start and end', () => {
    expect(splitReactions('[laugh]')).toEqual([{ kind: 'react', name: 'laugh' }])
    expect(splitReactions('Fair enough. [chuckle]')).toEqual([
      { kind: 'text', text: 'Fair enough. ' },
      { kind: 'react', name: 'chuckle' },
    ])
  })

  it('leaves brackets it does not know as ordinary text', () => {
    expect(splitReactions('See [figure 2].')).toEqual([{ kind: 'text', text: 'See [figure 2].' }])
  })

  it('accepts tags in any case', () => {
    expect(splitReactions('[LAUGH]')).toEqual([{ kind: 'react', name: 'laugh' }])
  })
})

describe('stripReactions', () => {
  it('removes tags for the transcript and tidies the spacing', () => {
    expect(stripReactions('Right, that is the trap. [sigh] Try again.')).toBe('Right, that is the trap. Try again.')
    expect(stripReactions('Fair enough [chuckle].')).toBe('Fair enough.')
    expect(stripReactions('[laugh]')).toBe('')
  })
})

describe('pickReaction', () => {
  it('returns null when no clip is recorded for the tag', () => {
    expect(pickReaction({ laugh: ['laugh/laugh-1.wav'] }, 'sigh')).toBeNull()
    expect(pickReaction({ sigh: [] }, 'sigh')).toBeNull()
  })

  it('picks one of the recorded clips', () => {
    const manifest = { cough: ['cough/a.wav', 'cough/b.wav'] }
    expect(pickReaction(manifest, 'cough', () => 0)).toBe('cough/a.wav')
    expect(pickReaction(manifest, 'cough', () => 0.99)).toBe('cough/b.wav')
  })
})

describe('the shipped reaction clips', () => {
  const root = join(__dirname, '../../../public/reactions')
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<string, string[]>

  it('only lists files that exist', () => {
    for (const files of Object.values(manifest)) {
      for (const f of files) expect(existsSync(join(root, f))).toBe(true)
    }
  })

  it('only uses tags the tutor is allowed to write', () => {
    for (const name of Object.keys(manifest)) expect(REACTION_NAMES).toContain(name)
  })
})
