import { cn } from '@/lib/utils'

export function MasteryBar({
  value,
  label,
  className,
  tone = 'accent',
}: {
  value: number
  label?: string
  className?: string
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'muted'
}) {
  const pct = Math.round(value * 100)
  const color = {
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    muted: 'bg-muted',
  }[tone]
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label ? (
        <div className="flex justify-between text-[13px] text-muted">
          <span>{label}</span>
          <span className="font-mono text-foreground/80">{pct}%</span>
        </div>
      ) : null}
      <div
        className="h-[3px] w-full bg-border"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn('h-full transition-[width] duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function toneFor(value: number) {
  if (value >= 0.75) return 'success' as const
  if (value >= 0.5) return 'accent' as const
  if (value >= 0.35) return 'warning' as const
  return 'danger' as const
}

