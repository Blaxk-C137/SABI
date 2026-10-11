/**
 * The Piper voices the tutor speaks with. Each is a VITS model exported to ONNX:
 * a `.onnx` file and a `.onnx.json` config, kept side by side. Piper turns text
 * into phonemes with espeak-ng, then the network makes the audio. Everything
 * runs on this machine; nothing is sent to a speech service.
 *
 * Only these medium-quality English voices ship. Piper has no Nigerian, Ghanaian
 * or Indian English voice, so those accents use a British voice and the settings
 * drawer says so.
 */
export const PIPER_RELEASE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

export interface PiperVoice {
  /** The file stem, which is also the id the browser stores. */
  id: string
  label: string
  accent: 'en-GB' | 'en-US'
  /**
   * Path inside the rhasspy/piper-voices repository, without the extension. The
   * installer downloads only voices that have one; a voice you train yourself
   * is added without it and its files are yours to place (see the README).
   */
  hfPath?: string
}

export const PIPER_VOICES: PiperVoice[] = [
  {
    id: 'en_US-lessac-medium',
    label: 'Lessac · American, medium',
    accent: 'en-US',
    hfPath: 'en/en_US/lessac/medium/en_US-lessac-medium',
  },
  {
    id: 'en_GB-jenny_dioco-medium',
    label: 'Jenny · British, medium',
    accent: 'en-GB',
    hfPath: 'en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium',
  },
  {
    id: 'en_GB-alan-medium',
    label: 'Alan · British, medium',
    accent: 'en-GB',
    hfPath: 'en/en_GB/alan/medium/en_GB-alan-medium',
  },
]

/** The default for an "Auto" choice: the British voice. */
export const DEFAULT_VOICE = 'en_GB-jenny_dioco-medium'

const ACCENT_DEFAULTS: Record<string, string> = {
  'en-GB': 'en_GB-jenny_dioco-medium',
  'en-US': 'en_US-lessac-medium',
  'en-NG': 'en_GB-jenny_dioco-medium',
  'en-GH': 'en_GB-jenny_dioco-medium',
  'en-IN': 'en_GB-jenny_dioco-medium',
}

export function isPiperVoice(id: string): boolean {
  return PIPER_VOICES.some((v) => v.id === id)
}

/** The voice for an accent id, falling back to the British default. */
export function voiceForAccent(accent: string | undefined | null): string {
  return (accent && ACCENT_DEFAULTS[accent]) || DEFAULT_VOICE
}

/**
 * The voice to use for a request: the named one if it ships, otherwise the accent's.
 * Settings saved before the switch to Piper hold Kokoro ids, which must not fail
 * every reply.
 */
export function resolveVoice(id: string | undefined | null, accent: string | undefined | null): string {
  return id && isPiperVoice(id) ? id : voiceForAccent(accent)
}

/** Speed is a multiplier: 1 is normal. Anything outside 0.5–2 is clamped. */
export function clampSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) return 1
  return Math.min(2, Math.max(0.5, speed))
}

/** Piper's `length_scale` is the inverse of speed: a larger value means slower speech. */
export function lengthScale(speed: number): number {
  return 1 / clampSpeed(speed)
}
