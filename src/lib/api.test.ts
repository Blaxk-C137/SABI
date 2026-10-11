import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeAsrProgress, getHealth, postAsr } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Any clip at or above 1600 samples (0.1 s at 16 kHz). `postAsr` rejects
 * anything shorter before it reaches `fetch`, so every case that expects a
 * request to go out must use this, not a literal like `[0.1, 0.2, 0.3]`.
 */
const pcm = () => new Float32Array(2000)

describe('postAsr', () => {
  it('POSTs raw PCM and returns the transcript', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: 'delta U equals Q minus W' }))
    vi.stubGlobal('fetch', fetchMock)

    const sent = pcm()
    const text = await postAsr(sent)

    expect(text).toBe('delta U equals Q minus W')
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('/api/asr')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/octet-stream',
    )
    // Identity, not merely presence: `postAsr` must hand `fetch` the very view it
    // was given. Switching to `pcm.buffer` would send the whole backing buffer
    // for a subarray, and without this assertion that regression is invisible —
    // deleting `body:` entirely would also pass.
    expect(init.body).toBe(sent)
  })

  it('throws the server error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Whisper heard silence.' }, 422)))
    await expect(postAsr(pcm())).rejects.toThrow('Whisper heard silence.')
  })

  it('throws a readable message when the body is not JSON', async () => {
    // The fixture deliberately contains no digits. Node's `res.json()` error for
    // non-JSON text quotes the offending body, so a fixture reading
    // `<html>502</html>` would satisfy a `/502/` assertion straight from that
    // SyntaxError — the fallback this test exists to cover could be deleted
    // outright and the test would still pass. Asserting the exact fallback
    // message is what makes it discriminate.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })),
    )
    await expect(postAsr(pcm())).rejects.toThrow('Request failed with status 502.')
  })

  it('refuses to send a clip too short to transcribe', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(postAsr(new Float32Array(10))).rejects.toThrow(/too short/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the chosen model in the query string', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)
    await postAsr(pcm(), 'Xenova/whisper-base')
    const [url] = fetchMock.mock.calls[0]! as unknown as [string]
    expect(url).toBe('/api/asr?model=Xenova%2Fwhisper-base')
  })

  it('leaves the model off entirely when none is chosen, so the server default applies', async () => {
    // A trailing `?model=` would be an empty value the server must special-case;
    // omitting it means "server default" is stated by the request itself.
    const fetchMock = vi.fn(async () => jsonResponse({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)
    await postAsr(pcm(), '')
    const [url] = fetchMock.mock.calls[0]! as unknown as [string]
    expect(url).toBe('/api/asr')
  })

  it('reports silence when the server returns blank text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ text: '   ' })))
    await expect(postAsr(pcm())).rejects.toThrow('Whisper heard silence. Speak closer to the mic.')
  })
})

describe('getHealth', () => {
  it('returns the ASR status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ asr: { state: 'ready', progress: 100 } })))
    expect(await getHealth()).toMatchObject({ asr: { state: 'ready' } })
  })

  it('throws the server error message when health is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Backend is down.' }, 503)))
    await expect(getHealth()).rejects.toThrow('Backend is down.')
  })
})

describe('describeAsrProgress', () => {
  it('is silent when the model is ready', () => {
    expect(describeAsrProgress({ state: 'ready', progress: 100 })).toBeNull()
  })

  it('is silent when cold, so the UI shows nothing before first use', () => {
    expect(describeAsrProgress({ state: 'cold', progress: 0 })).toBeNull()
  })

  it('reports download progress', () => {
    expect(describeAsrProgress({ state: 'loading', progress: 43 })).toBe('Whisper · 43%')
  })

  it('names the model being downloaded, so a slow one is identifiable', () => {
    expect(describeAsrProgress({ state: 'loading', progress: 43 }, 'Whisper base')).toBe(
      'Whisper base · 43%',
    )
  })

  it('reports the error text when the worker failed', () => {
    expect(describeAsrProgress({ state: 'error', progress: 0, error: 'boom' })).toBe('boom')
  })

  it('tolerates a null status', () => {
    expect(describeAsrProgress(null)).toBeNull()
  })

  it('falls back to a generic message when an error carries no text', () => {
    expect(describeAsrProgress({ state: 'error', progress: 0 })).toBe('Voice backend error.')
  })
})

