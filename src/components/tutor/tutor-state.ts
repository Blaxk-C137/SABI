import type { VoiceState } from '@/lib/voice/types'

export const orbPalette: Record<
  VoiceState,
  { ring: string; core: string; label: string }
> = {
  idle: { ring: '#c4a574', core: '#8a6a3a', label: 'Ready' },
  listening: { ring: '#7aa4a8', core: '#4d7c80', label: 'Listening' },
  processing: { ring: '#c4a06a', core: '#8a6e3a', label: 'Transcribing' },
  thinking: { ring: '#c4a06a', core: '#8a6e3a', label: 'Working from your notes' },
  speaking: { ring: '#d4b888', core: '#c4a574', label: 'Speaking' },
  paused: { ring: '#9a968a', core: '#6b675c', label: 'Paused' },
  error: { ring: '#c45c4a', core: '#8a3c30', label: 'Voice error' },
}

export function stateIsActive(s: VoiceState) {
  return s === 'listening' || s === 'speaking' || s === 'thinking' || s === 'processing'
}

