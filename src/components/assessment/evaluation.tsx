import { MasteryBreakdown } from './mastery-breakdown'
import type { Evaluation as EvaluationData } from '@/lib/assessment/types'

export function EvaluationView({
  stage,
  evaluation,
}: {
  stage?: string
  evaluation?: EvaluationData
}) {
  if (!evaluation) {
    return (
      <div className="border border-border bg-surface px-5 py-8" aria-live="polite">
        <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-accent">
          {stage ?? 'Reading your answer…'}
        </p>
        <p className="mt-3 text-muted text-sm">
          Checking the explanation against your notes — not hidden model theatrics.
        </p>
      </div>
    )
  }
  return (
    <div className="grid gap-6">
      <p className="serif text-2xl leading-snug max-w-[40ch]">{evaluation.summary}</p>
      <MasteryBreakdown evaluation={evaluation} />
    </div>
  )
}

