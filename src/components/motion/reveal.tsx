import { useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { cn } from '@/lib/utils'

gsap.registerPlugin(useGSAP)

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.from(ref.current, {
        y: 16,
        opacity: 0,
        duration: 0.55,
        delay,
        ease: 'power2.out',
      })
    },
    { scope: ref },
  )
  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  )
}

