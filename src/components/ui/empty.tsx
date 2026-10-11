import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string
  body: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'border border-dashed border-border bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-foreground">{title}</p>
      <p className="mt-2 text-sm text-muted max-w-prose mx-auto">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

