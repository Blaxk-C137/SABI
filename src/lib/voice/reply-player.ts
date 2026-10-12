import type { TutorStep } from '@/lib/gemini/board'

/**
 * Plays a reply's steps in order: speech, the board writing line by line while
 * it is spoken, then more speech. It knows nothing about React or audio. The
 * caller supplies `speak`, so the same walk drives the real voice, the silent
 * timed mode, and the tests.
 *
 * The steps can be a finished list or a live queue that fills while the reply
 * streams. The walk waits for the next step when the queue is empty.
 */
export interface PlayHooks {
  /** Speak one piece. `kind` is 'say' for tutor speech, 'line' for a board line. Resolves when finished or cancelled. */
  speak(text: string, kind: 'say' | 'line'): Promise<void>
  /** Wait for `ms`, or until cancelled. Used when speech is off. */
  pause(ms: number): Promise<void>
  /** True once the reply has been stopped or replaced. */
  cancelled(): boolean
  onStep(index: number, step: TutorStep): void
  /** A board line is about to be spoken; `shown` lines are now on the board. */
  onLine(stepIndex: number, shown: number): void
  onCaption(text: string): void
}

export async function playReply(
  steps: Iterable<TutorStep> | AsyncIterable<TutorStep>,
  hooks: PlayHooks,
): Promise<void> {
  let index = 0
  for await (const step of steps) {
    if (hooks.cancelled()) return
    const i = index++
    hooks.onStep(i, step)
    if (step.kind === 'say') {
      if (!step.spoken) continue
      hooks.onCaption(step.text)
      await hooks.speak(step.spoken, 'say')
      continue
    }
    for (let l = 0; l < step.lines.length; l++) {
      if (hooks.cancelled()) return
      hooks.onLine(i, l + 1)
      hooks.onCaption(step.lines[l]!)
      const spoken = step.spokenLines[l]
      if (spoken) await hooks.speak(spoken, 'line')
      else await hooks.pause(350)
    }
  }
}

/** A list of steps that grows while a reply streams in. Closing it ends the walk. */
export interface StepQueue {
  push(step: TutorStep): void
  close(): void
  steps: AsyncIterable<TutorStep>
}

export function createStepQueue(): StepQueue {
  const items: TutorStep[] = []
  let closed = false
  let wake: (() => void) | null = null
  const notify = () => {
    const w = wake
    wake = null
    w?.()
  }
  async function* drain(): AsyncGenerator<TutorStep> {
    let next = 0
    for (;;) {
      if (next < items.length) {
        yield items[next++]!
        continue
      }
      if (closed) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }
  return {
    push(step) {
      if (closed) return
      items.push(step)
      notify()
    },
    close() {
      closed = true
      notify()
    },
    steps: drain(),
  }
}

/** How long a line stays on screen when speech is off: roughly reading speed. */
export function silentPauseMs(text: string): number {
  return Math.min(4000, 300 + text.length * 22)
}
