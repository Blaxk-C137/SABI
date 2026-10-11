import { Mic, MicOff, Pause, Play, Square, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VoiceState } from '@/lib/voice/types'
import { cn } from '@/lib/utils'

export function TutorControls({
  state,
  onMic,
  onStopMic,
  onPause,
  onResume,
  onStopSpeak,
  onToggleType,
  typing,
  disabled,
}: {
  state: VoiceState
  onMic: () => void
  onStopMic: () => void
  onPause: () => void
  onResume: () => void
  onStopSpeak: () => void
  onToggleType: () => void
  typing: boolean
  disabled?: boolean
}) {
  const listening = state === 'listening'
  return (
    <div className="flex items-center justify-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={typing ? 'Hide keyboard' : 'Type instead'}
        onClick={onToggleType}
      >
        <Keyboard className="size-5" />
      </Button>

      {state === 'speaking' ? (
        <Button type="button" variant="outline" size="icon" aria-label="Pause speech" onClick={onPause}>
          <Pause className="size-5" />
        </Button>
      ) : null}
      {state === 'paused' ? (
        <Button type="button" variant="outline" size="icon" aria-label="Resume speech" onClick={onResume}>
          <Play className="size-5" />
        </Button>
      ) : null}

      <Button
        type="button"
        variant={listening ? 'danger' : 'primary'}
        size="mic"
        aria-label={listening ? 'Stop recording' : 'Speak'}
        aria-pressed={listening}
        disabled={disabled}
        onClick={listening ? onStopMic : onMic}
        className={cn('shadow-[0_0_0_8px_color-mix(in_srgb,var(--accent)_12%,transparent)]')}
      >
        {listening ? <MicOff className="size-7" /> : <Mic className="size-7" />}
      </Button>

      {state === 'speaking' || state === 'paused' ? (
        <Button type="button" variant="ghost" size="icon" aria-label="Stop speaking" onClick={onStopSpeak}>
          <Square className="size-4" />
        </Button>
      ) : (
        <span className="size-11" aria-hidden="true" />
      )}
    </div>
  )
}

