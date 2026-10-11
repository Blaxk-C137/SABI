export function explainError(e: unknown) {
  console.error('[sabi]', e)
  if (e instanceof Error) {
    const msg = (e.message || e.name || 'Unknown error').trim()
    return msg
  }
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return 'Unknown error'
  }
}

