import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full bg-elevated px-3 text-[15px] text-foreground placeholder:text-muted border border-border focus:border-accent',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full min-h-32 bg-elevated px-3 py-3 text-[15px] leading-relaxed text-foreground placeholder:text-muted border border-border focus:border-accent resize-y',
        className,
      )}
      {...props}
    />
  )
}

