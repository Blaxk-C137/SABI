export type VoiceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'error'

export interface SpeechPlan {
  text: string
  emotion?: 'neutral' | 'encouraging' | 'challenging' | 'calm' | 'corrective'
  speed?: number
  pauseAfter?: string[]
  emphasis?: string[]
}

export const voiceStateCopy: Record<VoiceState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  processing: 'Transcribing what you said',
  thinking: 'Working from your notes',
  speaking: 'Speaking',
  paused: 'Paused',
  error: 'Voice error',
}

