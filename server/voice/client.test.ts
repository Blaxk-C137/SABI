import { describe, expect, it, vi } from 'vitest'
import { createVoiceClient, type WorkerLike } from './client.ts'

type Sent = { id: number; kind: string; model?: string; pcm?: Float32Array }

/** A worker stand-in the test drives by hand. */
function stubWorker() {
  const sent: Sent[] = []
  const transfers: (readonly ArrayBuffer[] | undefined)[] = []
  const terminate = vi.fn(async () => 0)
  const listeners = {
    message: [] as ((v: unknown) => void)[],
    exit: [] as ((c: number) => void)[],
    error: [] as ((e: Error) => void)[],
  }
  const worker: WorkerLike = {
    postMessage(value: unknown, transfer?: readonly ArrayBuffer[]) {
      sent.push(value as Sent)
      transfers.push(transfer)
    },
    on(event: string, listener: (arg: never) => void) {
      ;(listeners as Record<string, ((arg: never) => void)[]>)[event]!.push(listener)
      return worker
    },
    terminate,
  }
  return {
    worker,
    sent,
    transfers,
    terminate,
    reply: (msg: unknown) => listeners.message.forEach((l) => l(msg)),
    progress: (id: number, progress: number) =>
      listeners.message.forEach((l) => l({ id, type: 'progress', progress })),
    exit: (code: number) => listeners.exit.forEach((l) => l(code)),
  }
}

function clientWith(worker: WorkerLike) {
  return createVoiceClient({ modelDir: '/tmp/x', spawn: () => worker })
}

/**
 * Any clip at or above 1600 samples (0.1 s at 16 kHz). transcribe() rejects
 * anything shorter before it posts to the worker, so every test that expects
 * work to reach the worker must use this, not a literal like [1].
 */
const pcm = () => new Float32Array(2000)

describe('createVoiceClient', () => {
  it('starts cold', () => {
    const s = stubWorker()
    expect(clientWith(s.worker).status().asr.state).toBe('cold')
  })

  it('rejects a clip too short to be speech without troubling the worker', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    await expect(client.transcribe(new Float32Array(10))).rejects.toThrow(/almost no audio/i)
    expect(s.sent.length).toBe(0)
  })

  it('resolves a transcription by request id', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    expect(s.sent[0]!.kind).toBe('asr')
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: 'delta U equals Q minus W' } })
    await expect(pending).resolves.toBe('delta U equals Q minus W')
    expect(client.status().asr.state).toBe('ready')
  })

  it('forwards the requested model to the worker', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm(), 'Xenova/whisper-base')
    expect(s.sent[0]?.model).toBe('Xenova/whisper-base')
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: 'ok' } })
    await pending
  })

  it('omits the model when the caller names none, so the worker picks the default', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    expect(s.sent[0]?.model).toBeUndefined()
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: 'ok' } })
    await pending
  })

  it('transfers the PCM buffer instead of copying it', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const clip = pcm()
    const pending = client.transcribe(clip)
    expect(s.transfers[0]?.[0]).toBe(clip.buffer)
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: 'ok' } })
    await expect(pending).resolves.toBe('ok')
  })

  it('keeps two in-flight requests from crossing wires', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const first = client.transcribe(pcm())
    const second = client.transcribe(pcm())
    const [a, b] = [s.sent[0]!.id, s.sent[1]!.id]
    expect(a).not.toBe(b)
    // resolve out of order — second first
    s.reply({ id: b, ok: false, error: 'second failed' })
    s.reply({ id: a, ok: true, result: { text: 'first' } })
    await expect(first).resolves.toBe('first')
    await expect(second).rejects.toThrow('second failed')
  })

  it('records download progress while loading', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    s.progress(s.sent[0]!.id, 43)
    expect(client.status().asr).toMatchObject({ state: 'loading', progress: 43 })
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: 'ok' } })
    await pending
  })

  it('rejects in-flight work and records an error when the worker dies', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    s.exit(1)
    await expect(pending).rejects.toThrow(/worker/i)
    expect(client.status().asr.state).toBe('error')
  })

  it('respawns after a crash so the next request is served', async () => {
    const s1 = stubWorker()
    const s2 = stubWorker()
    const workers = [s1.worker, s2.worker]
    let n = 0
    const client = createVoiceClient({ modelDir: '/tmp/x', spawn: () => workers[n++]! })
    const doomed = client.transcribe(pcm())
    s1.exit(1)
    await expect(doomed).rejects.toThrow()

    const next = client.transcribe(pcm())
    expect(s2.sent.length).toBe(1)
    s2.reply({ id: s2.sent[0]!.id, ok: true, result: { text: 'recovered' } })
    await expect(next).resolves.toBe('recovered')
  })

  it('reports an empty transcript as an error the route can surface', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    s.reply({ id: s.sent[0]!.id, ok: true, result: { text: '' } })
    await expect(pending).rejects.toThrow(/silence/i)
  })

  it('rejects in-flight work on dispose and does not treat the exit as a crash', async () => {
    const s = stubWorker()
    const client = clientWith(s.worker)
    const pending = client.transcribe(pcm())
    const done = client.dispose()
    await expect(pending).rejects.toThrow(/disposed/i)
    expect(s.terminate).toHaveBeenCalledTimes(1)
    s.exit(0) // the real worker's exit lands after terminate()
    expect(client.status().asr.state).not.toBe('error')
    await expect(client.transcribe(pcm())).rejects.toThrow(/disposed/i)
    expect(s.sent.length).toBe(1) // nothing was posted to a respawned worker
    await done
  })
})

