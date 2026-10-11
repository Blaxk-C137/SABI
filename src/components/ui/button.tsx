import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-none font-medium cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg hover:brightness-110 active:brightness-95',
        ghost:
          'bg-transparent text-foreground hover:bg-elevated border border-transparent hover:border-border',
        outline:
          'border border-border bg-transparent hover:bg-elevated text-foreground',
        danger: 'bg-danger text-white hover:brightness-110',
        brass:
          'border border-accent/40 text-accent hover:bg-accent hover:text-accent-fg',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[15px]',
        lg: 'h-12 px-5 text-base',
        icon: 'size-11',
        mic: 'size-16 rounded-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: Props) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

