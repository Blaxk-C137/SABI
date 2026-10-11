import { useEffect, useRef } from 'react'
import type { VoiceState } from '@/lib/voice/types'
import { orbPalette } from './tutor-state'

/**
 * 2D canvas orb, used when WebGL is unavailable and as the bar overlay.
 *
 * Everything is sized from the canvas's shorter side and kept inside a margin,
 * so the rings and bars never run past the edge (the old version scaled up to
 * 2.4× its base radius on a fixed 90 px, and clipped). The canvas backing store
 * follows its CSS size through a ResizeObserver rather than being set once.
 */
export function VoiceVisualizer({
  state,
  amplitude = 0,
  pitch = 0,
  bands,
  barsOnly = false,
  className,
}: {
  state: VoiceState
  amplitude?: number
  pitch?: number
  bands?: number[]
  barsOnly?: boolean
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const ampRef = useRef(amplitude)
  const pitchRef = useRef(pitch)
  const bandsRef = useRef(bands)
  useEffect(() => {
    stateRef.current = state
    ampRef.current = amplitude
    pitchRef.current = pitch
    bandsRef.current = bands
  }, [state, amplitude, pitch, bands])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const particles = Array.from({ length: 48 }, (_, i) => ({
      a: (i / 48) * Math.PI * 2,
      r: 0.55 + (i % 7) * 0.03,
      s: 0.4 + (i % 5) * 0.12,
    }))

    const draw = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      const cx = w / 2
      const cy = h / 2
      const half = Math.min(w, h) / 2
      const st = stateRef.current
      const pal = orbPalette[st]
      const amp = Math.min(1, ampRef.current)
      const pit = pitchRef.current
      const spec = bandsRef.current
      const time = reduced ? 0 : t / 1000

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Core radius and the most it can grow while staying inside `half`.
      const breathe = st === 'idle' ? 1 + Math.sin(time * 1.2) * 0.03 : 1
      const listenPulse = st === 'listening' ? Math.sin(time * (2.2 + pit * 2.4)) * 0.04 + amp * 0.1 : 0
      const speakPulse = st === 'speaking' ? amp * 0.14 : 0
      const core = half * 0.36 * breathe * (1 + listenPulse + speakPulse)
      const ceiling = half * 0.94 // nothing is drawn past this radius

      if ((st === 'listening' || st === 'speaking') && spec?.length) {
        const n = spec.length
        const barMax = Math.max(0, ceiling - core - 6)
        for (let i = 0; i < n; i++) {
          const level = spec[i] ?? 0
          const ang = (i / n) * Math.PI * 2 - Math.PI / 2
          const r0 = core + 6
          const r1 = r0 + barMax * Math.min(1, 0.12 + level * 0.9)
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0)
          ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1)
          ctx.strokeStyle = pal.ring
          ctx.globalAlpha = 0.3 + level * 0.6
          ctx.lineWidth = Math.max(1.5, half * 0.012)
          ctx.lineCap = 'round'
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }

      if (barsOnly) {
        raf = requestAnimationFrame(draw)
        return
      }

      if (st === 'listening' || st === 'speaking') {
        const rings = st === 'listening' ? 3 : 2
        for (let i = 0; i < rings; i++) {
          const p = (time * (st === 'listening' ? 0.35 : 0.5) + i / rings) % 1
          ctx.beginPath()
          ctx.arc(cx, cy, core + (ceiling - core) * p, 0, Math.PI * 2)
          ctx.strokeStyle = pal.ring
          ctx.globalAlpha = (1 - p) * 0.28
          ctx.lineWidth = 1.2
          ctx.stroke()
        }
      }

      ctx.globalAlpha = 1
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, core)
      grd.addColorStop(0, pal.ring)
      grd.addColorStop(0.5, pal.core)
      grd.addColorStop(1, pal.core + '00')
      ctx.beginPath()
      ctx.arc(cx, cy, core, 0, Math.PI * 2)
      ctx.fillStyle = grd
      ctx.fill()

      ctx.beginPath()
      ctx.arc(cx, cy, core * 0.22, 0, Math.PI * 2)
      ctx.fillStyle = pal.ring
      ctx.globalAlpha = st === 'thinking' ? 0.9 : 0.7
      ctx.fill()
      ctx.globalAlpha = 1

      if (st === 'thinking') {
        for (let i = 0; i < 3; i++) {
          const ang = time * 0.7 + (i * Math.PI * 2) / 3
          const rr = core * 1.25
          ctx.beginPath()
          ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, Math.max(2, half * 0.02), 0, Math.PI * 2)
          ctx.fillStyle = pal.ring
          ctx.fill()
        }
      }

      if (st === 'speaking' || st === 'listening') {
        particles.forEach((p) => {
          const jitter = st === 'speaking' ? amp * 10 : 3
          const r = core * p.r + Math.sin(time * p.s * 3 + p.a) * jitter
          const rr = Math.min(r, ceiling)
          ctx.beginPath()
          ctx.arc(cx + Math.cos(p.a + time * 0.15) * rr, cy + Math.sin(p.a + time * 0.15) * rr, 1.1, 0, Math.PI * 2)
          ctx.fillStyle = pal.ring
          ctx.globalAlpha = 0.55
          ctx.fill()
        })
        ctx.globalAlpha = 1
      }

      raf = requestAnimationFrame(draw)
    }

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [barsOnly])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
