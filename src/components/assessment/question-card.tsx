import type { Question } from '@/lib/assessment/types'

export function QuestionCard({
  question,
  index,
  total,
}: {
  question: Question
  index: number
  total: number
}) {
  return (
    <header className="grid gap-3">
      <p className="font-mono text-[12px] text-muted">
        Question {index + 1} of {total} · {question.kind}
      </p>
      <h1 className="serif text-[28px] md:text-[34px] leading-[1.25] max-w-[22ch]">
        {question.prompt}
      </h1>
    </header>
  )
}

