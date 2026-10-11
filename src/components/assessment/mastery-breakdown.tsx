import type { Evaluation } from '@/lib/assessment/types'
import { MasteryBar, toneFor } from '@/components/ui/progress'

const rows: { key: keyof Pick<Evaluation, 'recall' | 'explanation' | 'application' | 'reasoning'>; label: string }[] =
  [
    { key: 'recall', label: 'Recall' },
    { key: 'explanation', label: 'Explanation' },
    { key: 'application', label: 'Application' },
    { key: 'reasoning', label: 'Reasoning' },
  ]

export function MasteryBreakdown({ evaluation }: { evaluation: Evaluation }) {
  return (
    <section className="grid gap-5" aria-label="Understanding breakdown">
      <div className="grid gap-4">
        {rows.map((r) => (
          <MasteryBar
            key={r.key}
            label={r.label}
            value={evaluation[r.key]}
            tone={toneFor(evaluation[r.key])}
          />
        ))}
      </div>
      <dl className="grid gap-4 text-[15px] leading-relaxed">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">What you got right</dt>
          <dd className="mt-1">
            {evaluation.gotRight.map((g) => (
              <p key={g}>— {g}</p>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">What you’re missing</dt>
          <dd className="mt-1">
            {evaluation.missing.map((g) => (
              <p key={g}>— {g}</p>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Why it matters</dt>
          <dd className="mt-1 max-w-[65ch]">{evaluation.whyItMatters}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Try this</dt>
          <dd className="mt-1 serif text-lg">{evaluation.tryThis}</dd>
        </div>
      </dl>
    </section>
  )
}

