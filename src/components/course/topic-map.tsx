import { Link } from 'react-router-dom'
import type { Course } from '@/lib/course/types'
import { MasteryBar, toneFor } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export function TopicMap({
  course,
  hrefFor,
}: {
  course: Course
  hrefFor?: (topicId: string) => string
}) {
  return (
    <ol className="grid gap-0">
      {course.topics.map((t, i) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-muted w-6">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[17px]">{t.title}</span>
              </span>
              <span className="text-[12px] uppercase tracking-[0.14em] text-muted">
                {t.status}
              </span>
            </div>
            <div className="pl-9 mt-2">
              <MasteryBar value={t.overall} tone={toneFor(t.overall)} />
              {t.misconception ? (
                <p className="mt-2 text-sm text-warning">Watch: {t.misconception}</p>
              ) : null}
            </div>
          </>
        )
        const className = cn(
          'block py-4 border-b border-border last:border-0',
          hrefFor && 'hover:bg-elevated/50 -mx-3 px-3',
        )
        return (
          <li key={t.id}>
            {hrefFor ? (
              <Link to={hrefFor(t.id)} className={className}>
                {inner}
              </Link>
            ) : (
              <div className={className}>{inner}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

