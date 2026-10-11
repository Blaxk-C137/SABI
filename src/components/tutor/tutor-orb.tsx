import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import type { VoiceState } from '@/lib/voice/types'
import { VoiceVisualizer } from './voice-visualizer'
import { orbPalette } from './tutor-state'

const TutorOrb3D = lazy(() => import('./tutor-orb-3d'))

export function TutorOrb({
  state,
  amplitude = 0,
  pitch = 0,
  bands,
  prefer3d = true,
}: {
  state: VoiceState
  amplitude?: number
  pitch?: number
  bands?: number[]
  prefer3d?: boolean
}) {
  const [webglFailed, setWebglFailed] = useState(false)
  const pal = orbPalette[state]
  const use3d = prefer3d && !webglFailed

  return (
    <div className="relative aspect-square w-full max-w-[420px] mx-auto">
      <p className="sr-only" aria-live="polite">
        Tutor is {pal.label}
      </p>
      {use3d ? (
        <Suspense
          fallback={
            <VoiceVisualizer
              state={state}
              amplitude={amplitude}
              pitch={pitch}
              bands={bands}
              className="absolute inset-0 h-full w-full"
            />
          }
        >
          <Boundary onError={() => setWebglFailed(true)}>
            <TutorOrb3D state={state} amplitude={amplitude} pitch={pitch} />
          </Boundary>
        </Suspense>
      ) : (
        <VoiceVisualizer
          state={state}
          amplitude={amplitude}
          pitch={pitch}
          bands={bands}
          className="absolute inset-0 h-full w-full"
        />
      )}
      {use3d && (state === 'listening' || state === 'speaking') ? (
        <VoiceVisualizer
          state={state}
          amplitude={amplitude}
          pitch={pitch}
          bands={bands}
          barsOnly
          className="absolute inset-0 h-full w-full pointer-events-none"
        />
      ) : null}
    </div>
  )
}

class Boundary extends Component<
  { children: ReactNode; onError: () => void },
  { err: boolean }
> {
  state = { err: false }
  static getDerivedStateFromError() {
    return { err: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    if (this.state.err) return null
    return this.props.children
  }
}

