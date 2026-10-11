export type MicFrame = {
  amp: number
  pitch: number
  hz: number
  brightness: number
  bands: number[]
}

function audioContext() {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) throw new Error('No AudioContext on this browser.')
  return new AC()
}

/** Autocorrelation pitch in Hz. 0 if the frame is too quiet or unvoiced. */
function pitchHz(buf: Float32Array, sampleRate: number) {
  let rms = 0
  for (let i = 0; i < buf.length; i++) rms += buf[i]! * buf[i]!
  rms = Math.sqrt(rms / buf.length)
  if (rms < 0.012) return 0

  const size = buf.length
  const maxSamples = Math.floor(size / 2)
  const minLag = Math.floor(sampleRate / 420)
  const maxLag = Math.min(Math.floor(sampleRate / 70), maxSamples)
  let bestLag = -1
  let bestCorr = 0
  let prev = 1

  for (let lag = minLag; lag < maxLag; lag++) {
    let corr = 0
    for (let i = 0; i < maxSamples; i++) corr += buf[i]! * buf[i + lag]!
    corr /= maxSamples
    if (corr > bestCorr && corr > prev) {
      bestCorr = corr
      bestLag = lag
    }
    prev = corr
  }
  if (bestLag < 0 || bestCorr < 0.01) return 0
  return sampleRate / bestLag
}

export function startMicMonitor(stream: MediaStream, onFrame: (f: MicFrame) => void) {
  const ctx = audioContext()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.62
  src.connect(analyser)

  const time = new Float32Array(analyser.fftSize)
  const freq = new Uint8Array(analyser.frequencyBinCount)
  const BANDS = 24
  let raf = 0
  let alive = true

  const tick = () => {
    if (!alive) return
    analyser.getFloatTimeDomainData(time)
    analyser.getByteFrequencyData(freq)

    let sum = 0
    for (let i = 0; i < time.length; i++) sum += time[i]! * time[i]!
    const rms = Math.sqrt(sum / time.length)
    const amp = Math.min(1, rms * 5.2)

    const hz = pitchHz(time, ctx.sampleRate)
    const pitch = hz ? Math.min(1, Math.max(0, (hz - 80) / 320)) : 0

    let weighted = 0
    let total = 0
    for (let i = 0; i < freq.length; i++) {
      weighted += i * freq[i]!
      total += freq[i]!
    }
    const brightness = total ? weighted / total / freq.length : 0

    const bands: number[] = []
    const slice = Math.max(1, Math.floor(freq.length / BANDS))
    for (let b = 0; b < BANDS; b++) {
      let acc = 0
      const start = b * slice
      for (let i = start; i < start + slice && i < freq.length; i++) acc += freq[i]!
      bands.push(acc / slice / 255)
    }

    onFrame({ amp, pitch, hz, brightness, bands })
    raf = requestAnimationFrame(tick)
  }

  void ctx.resume().then(() => {
    if (alive) raf = requestAnimationFrame(tick)
  })

  return () => {
    alive = false
    cancelAnimationFrame(raf)
    try {
      src.disconnect()
    } catch {
      /* already gone */
    }
    void ctx.close().catch(() => undefined)
  }
}

