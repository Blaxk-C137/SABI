import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('bg-elevated animate-pulse', className)}
      aria-hidden="true"
    />
  )
}

