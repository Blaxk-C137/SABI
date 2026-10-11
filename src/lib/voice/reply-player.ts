import type { TutorStep } from '@/lib/gemini/board'

/**
 * Plays a reply's steps in order: speech, the board writing line by line while
 * it is spoken, then more speech. It knows nothing about React or audio. The
 * caller supplies `speak`, so the same walk drives the real voice, the silent
 * timed mode, and the tests.
 */
export interface PlayHooks {
  /** Speak one line. Resolves when it has finished or been cancelled. */
  speak(text: string): Promise<void>
  /** Wait for `ms`, or until cancelled. Used when speech is off. */
  pause(ms: number): Promise<void>
  /** True once the reply has been stopped or replaced. */
  cancelled(): boolean
  onStep(index: number, step: TutorStep): void
  /** A board line is about to be spoken; `shown` lines are now on the board. */
  onLine(stepIndex: number, shown: number): void
  onCaption(text: string): void
}

export async function playReply(steps: TutorStep[], hooks: PlayHooks): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    if (hooks.cancelled()) return
    const step = steps[i]!
    hooks.onStep(i, step)
    if (step.kind === 'say') {
      if (!step.spoken) continue
      hooks.onCaption(step.text)
      await hooks.speak(step.spoken)
      continue
    }
    for (let l = 0; l < step.lines.length; l++) {
      if (hooks.cancelled()) return
      hooks.onLine(i, l + 1)
      hooks.onCaption(step.lines[l]!)
      const spoken = step.spokenLines[l]
      if (spoken) await hooks.speak(spoken)
      else await hooks.pause(350)
    }
  }
}

/** How long a line stays on screen when speech is off: roughly reading speed. */
export function silentPauseMs(text: string): number {
  return Math.min(4000, 300 + text.length * 22)
}
