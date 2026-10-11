import type { Course } from '@/lib/course/types'
import { tutorById } from '@/lib/course/data'

export function CourseHeader({ course }: { course: Course }) {
  const tutor = tutorById(course.tutorId)
  return (
    <header className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end border-b border-border pb-6">
      <div>
        <p className="font-mono text-[12px] tracking-[0.14em] text-muted">
          {course.code} · {course.level} level · {course.lecturer}
        </p>
        <h1 className="mt-2 serif text-3xl md:text-4xl leading-tight">{course.title}</h1>
        <p className="mt-3 max-w-[60ch] text-muted text-[15px]">{course.blurb}</p>
      </div>
      <div className="text-right">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Notation in these notes</p>
        <p className="eq mt-1 text-lg text-accent">{course.notation}</p>
        {tutor ? (
          <p className="mt-2 text-sm text-muted">
            Tutor {tutor.name} · {tutor.accent}
          </p>
        ) : null}
      </div>
    </header>
  )
}

