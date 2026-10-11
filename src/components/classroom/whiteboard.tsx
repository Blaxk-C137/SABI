import { useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { MathText } from '@/components/md/math-text'
import { cn } from '@/lib/utils'

gsap.registerPlugin(useGSAP)

const inks = [
  { id: 'navy', hex: '#1c2740' },
  { id: 'blue', hex: '#1e4b8c' },
  { id: 'red', hex: '#9a2b24' },
] as const

/**
 * The board is presentational. The reply player decides what is written and
 * when, and passes in how many lines are up. Nothing here speaks or cancels
 * speech, so a re-render cannot interrupt the tutor.
 */
export function Whiteboard({
  title,
  lines,
  shown,
  writing,
  onWipe,
  onClose,
}: {
  title: string
  lines: string[]
  shown: number
  writing: boolean
  onWipe: () => void
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [ink, setInk] = useState<(typeof inks)[number]['id']>('navy')
  const [wiped, setWiped] = useState(false)
  const [dusting, setDusting] = useState(false)
  const visible = wiped ? [] : lines.slice(0, shown)

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.from(root.current, { y: 18, opacity: 0, duration: 0.45, ease: 'power2.out' })
    },
    { scope: root },
  )

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const els = root.current?.querySelectorAll('.board-line')
      if (!els?.length) return
      gsap.from(els[els.length - 1]!, { opacity: 0, x: 10, duration: 0.35, ease: 'power1.out' })
    },
    { scope: root, dependencies: [visible.length] },
  )

  function wipe() {
    onWipe()
    setDusting(true)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duster = root.current?.querySelector('.duster-sweep')
    if (reduced || !duster) {
      setWiped(true)
      setDusting(false)
      return
    }
    gsap.fromTo(
      duster,
      { x: '-20%', opacity: 1 },
      {
        x: '110%',
        duration: 0.7,
        ease: 'power1.inOut',
        onComplete: () => {
          setWiped(true)
          setDusting(false)
          gsap.set(duster, { x: '-20%', opacity: 0 })
        },
      },
    )
  }

  const color = inks.find((i) => i.id === ink)?.hex ?? '#1c2740'

  return (
    <div ref={root} className="classroom w-full max-w-4xl mx-auto">
      <div className="board-frame">
        <div className="board-bezel">
          <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[#6b675c]">
            <span>{title}</span>
            <span>{writing && !wiped ? 'Writing' : wiped ? 'Wiped' : 'Set'}</span>
          </div>
          <div className="board-face relative overflow-hidden" style={{ color }} aria-live="polite">
            <div className="board-grid" aria-hidden="true" />
            {visible.length === 0 ? (
              <p className="relative z-[1] text-[#8a8678] text-sm">
                {wiped ? 'Board is clear.' : 'Waiting for the working…'}
              </p>
            ) : (
              <div className="relative z-[1] grid gap-4">
                {visible.map((b, i) => (
                  <div key={i} className="board-line">
                    <MathText text={b} className="board-ink max-w-none" />
                  </div>
                ))}
              </div>
            )}
            <div
              className={cn('marker-tip', writing && !wiped && 'is-writing')}
              aria-hidden="true"
              style={{ background: color }}
            />
            <div className="duster-sweep" aria-hidden="true" />
          </div>
        </div>
        <div className="board-tray">
          <div className="flex items-center gap-2">
            {inks.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn('marker-cap', ink === m.id && 'is-active')}
                style={{ background: m.hex }}
                aria-label={`${m.id} marker`}
                onClick={() => setInk(m.id)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn('duster-btn', dusting && 'is-dusting')}
              onClick={wipe}
              aria-label="Wipe the board"
            >
              Duster
            </button>
            <button type="button" className="tray-link" onClick={onClose}>
              Step back
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
