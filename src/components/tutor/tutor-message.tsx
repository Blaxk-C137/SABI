import type { ChatTurn } from '@/lib/ai/tutor-engine'
import { cn } from '@/lib/utils'

export function TutorMessage({
  turn,
  streaming,
}: {
  turn: ChatTurn
  streaming?: boolean
}) {
  const isTutor = turn.role === 'tutor'
  return (
    <article
      className={cn(
        'grid gap-2 py-4',
        isTutor ? '' : 'border-t border-border/70',
      )}
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
        {isTutor ? 'Tutor' : 'You'}
      </p>
      <p
        className={cn(
          'max-w-[65ch] text-[17px] leading-relaxed',
          isTutor ? 'serif text-foreground/95' : 'text-foreground/90',
        )}
      >
        {turn.text}
        {streaming ? <span className="ml-0.5 inline-block h-4 w-[2px] bg-accent align-middle" /> : null}
      </p>
    </article>
  )
}

