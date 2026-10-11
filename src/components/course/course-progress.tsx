import type { Course } from '@/lib/course/types'
import { overallMastery } from '@/lib/course/data'
import { MasteryBar, toneFor } from '@/components/ui/progress'

export function CourseProgress({ course }: { course: Course }) {
  const overall = overallMastery(course)
  const dims = ['recall', 'explanation', 'application', 'reasoning'] as const
  const avg = (k: (typeof dims)[number]) =>
    course.topics.reduce((s, t) => s + t.mastery[k], 0) / course.topics.length

  return (
    <section className="grid gap-5">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Course mastery</p>
        <p className="mt-1 font-mono text-3xl">{Math.round(overall * 100)}</p>
        <p className="text-sm text-muted mt-1">Not a single score — dimensions below.</p>
      </div>
      <MasteryBar value={overall} tone={toneFor(overall)} label="Combined" />
      {dims.map((d) => (
        <MasteryBar key={d} value={avg(d)} tone={toneFor(avg(d))} label={cap(d)} />
      ))}
      <p className="text-sm text-accent">{course.recommendation}</p>
    </section>
  )
}

function cap(s: string) {
  return s.slice(0, 1).toUpperCase() + s.slice(1)
}

