import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASR_MODEL } from './models.ts'
import { asrOptions, createAsrCache, type AsrPipe } from './worker.ts'

describe('asrOptions', () => {
  it('uses plain transcription for a short clip', () => {
    expect(asrOptions(5)).toEqual({ language: 'english', task: 'transcribe' })
  })

  it('chunks a clip longer than 28 seconds', () => {
    expect(asrOptions(45)).toEqual({
      language: 'english',
      task: 'transcribe',
      chunk_length_s: 20,
      stride_length_s: 4,
    })
  })

  it('takes the chunked path only above the threshold', () => {
    expect(asrOptions(28)).not.toHaveProperty('chunk_length_s')
    expect(asrOptions(28.1)).toHaveProperty('chunk_length_s', 20)
  })
})

describe('model id', () => {
  it('is whisper-small, as the spec pins it', () => {
    expect(DEFAULT_ASR_MODEL).toBe('Xenova/whisper-small')
  })
})

describe('createAsrCache', () => {
  const pipe = (async () => ({ text: 'ok' })) as unknown as AsrPipe
  const SMALL = 'Xenova/whisper-small'
  const BASE = 'Xenova/whisper-base'

  it('loads once and reuses the pipeline for the same model', async () => {
    const load = vi.fn(async () => pipe)
    const cache = createAsrCache(load)
    await cache.get(1, SMALL)
    await cache.get(2, SMALL)
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.current()).toBe(SMALL)
  })

  it('drops the old pipeline and loads when the model changes', async () => {
    const load = vi.fn(async () => pipe)
    const cache = createAsrCache(load)
    await cache.get(1, SMALL)
    await cache.get(2, BASE)
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith(2, BASE)
    expect(cache.current()).toBe(BASE)
  })

  it('shares one load between concurrent requests for the same model', async () => {
    // Two students starting at once must not trigger two downloads of the same
    // weights — the second would race the first for the same cache files.
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const load = vi.fn(async () => {
      await gate
      return pipe
    })
    const cache = createAsrCache(load)
    const first = cache.get(1, SMALL)
    const second = cache.get(2, SMALL)
    release()
    await Promise.all([first, second])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed load instead of caching the failure', async () => {
    const load = vi
      .fn<() => Promise<AsrPipe>>()
      .mockRejectedValueOnce(new Error('download interrupted'))
      .mockResolvedValueOnce(pipe)
    const cache = createAsrCache(load)
    await expect(cache.get(1, SMALL)).rejects.toThrow('download interrupted')
    await expect(cache.get(2, SMALL)).resolves.toBe(pipe)
    expect(cache.current()).toBe(SMALL)
  })
})

