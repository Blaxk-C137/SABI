import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Keyboard, Mic, MicOff, Settings2, Square } from 'lucide-react'
import { TutorOrb } from '@/components/tutor/tutor-orb'
import { MathText } from '@/components/md/math-text'
import { Whiteboard } from '@/components/classroom/whiteboard'
import { parseTutorPayload, parseTutorSteps } from '@/lib/gemini/board'
import { SetupHarness } from '@/components/harness/setup-harness'
import { SettingsDrawer } from '@/components/studio/settings-drawer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useAppState } from '@/lib/store'
import { streamTutorReply, type GeminiTurn } from '@/lib/gemini/tutor'
import { cancelSpeech, speakSession, stopTutorVoice, subscribeVoiceFrames } from '@/lib/voice/tutor-speak'
import { playReply, silentPauseMs } from '@/lib/voice/reply-player'
import { transcribeWithWhisper } from '@/lib/voice/whisper'
import { describeAsrProgress, getHealth, type AsrInfo } from '@/lib/api'
import { startMicMonitor } from '@/lib/voice/mic-monitor'
import { explainError } from '@/lib/debug'
import type { VoiceState } from '@/lib/voice/types'
import { cn } from '@/lib/utils'
import type { IntegrityMode } from '@/lib/course/types'

gsap.registerPlugin(useGSAP)

interface Turn {
  id: string
  role: 'tutor' | 'student'
  text: string
  streaming?: boolean
}

const modes: IntegrityMode[] = ['teach', 'practice', 'assessment', 'review']

export function Studio() {
  const { settings, patchSettings, files, addFiles, mode, setMode, ready } = useAppState()
  const toast = useToast()
  const [harness, setHarness] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [state, setState] = useState<VoiceState>('idle')
  const [amp, setAmp] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const [board, setBoard] = useState<{ key: string; title: string; lines: string[]; shown: number } | null>(null)
  const replyRef = useRef<{ session: string; live: boolean; timers: Set<() => void> } | null>(null)
  const [asrInfo, setAsrInfo] = useState<AsrInfo | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  // Resolved against the server's list, so a stale saved id can never be sent
  // and rejected — it simply falls back to the server default.
  const chosenModel = asrInfo?.models?.some((m) => m.id === settings.asrModel)
    ? settings.asrModel
    : undefined
  const whisperName =
    asrInfo?.models?.find((m) => m.id === (chosenModel ?? asrInfo.defaultModel))?.label ?? 'Whisper'
  const whisperNote = describeAsrProgress(asrInfo, whisperName)
  const [lineCaption, setLineCaption] = useState('')
  const [pitch, setPitch] = useState(0)
  const [bands, setBands] = useState<number[]>([])
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const monitorStop = useRef<(() => void) | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const history = useRef<GeminiTurn[]>([])

  useEffect(() => {
    if (ready && !settings.geminiKey) setHarness(true)
  }, [ready, settings.geminiKey])

  // Mirror the backend's real state while a transcription is in flight. The
  // caption then reports an actual model download and nothing else: setting it
  // optimistically on every recording made "Whisper small · 0%" flash under the
  // orb even once the model was installed, when no download was happening.
  useEffect(() => {
    if (!transcribing) return
    const tick = () => {
      getHealth()
        .then((h) => setAsrInfo(h.asr))
        .catch(() => undefined)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [transcribing])

  // One look at boot, so the model list is known before the first recording
  // rather than only while one is in flight.
  useEffect(() => {
    getHealth()
      .then((h) => setAsrInfo(h.asr))
      .catch(() => undefined)
  }, [])

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.from('.studio-orb', { scale: 0.86, opacity: 0, duration: 0.8, ease: 'power3.out' })
      gsap.from('.studio-dock', { y: 24, opacity: 0, duration: 0.5, delay: 0.2, ease: 'power2.out' })
    },
    { scope: root },
  )

  const lastTutor = [...turns].reverse().find((t) => t.role === 'tutor')
  const payload = useMemo(
    () => parseTutorPayload(lastTutor?.text ?? ''),
    [lastTutor?.text],
  )
  const showBoard = board !== null
  const caption = lineCaption || payload.speech

  // Stop the reply: cancels its speech session, its pauses, and its walk.
  const stopReply = useCallback(() => {
    const run = replyRef.current
    replyRef.current = null
    if (!run) return
    run.live = false
    cancelSpeech(run.session)
    run.timers.forEach((clear) => clear())
    run.timers.clear()
  }, [])

  // Play one reply's steps in written order. The player owns what is spoken
  // and what the board shows; components only render that state.
  const startReply = useCallback(
    (text: string) => {
      stopReply()
      setBoard(null)
      const steps = parseTutorSteps(text)
      if (steps.length === 0) {
        setState('idle')
        return
      }
      const run = { session: `reply-${Date.now()}`, live: true, timers: new Set<() => void>() }
      replyRef.current = run
      const voice = {
        voice: settings.ttsVoice || undefined,
        accent: settings.accent,
        speed: settings.ttsSpeed,
      }
      const pause = (ms: number) =>
        new Promise<void>((resolve) => {
          const id = window.setTimeout(resolve, ms)
          run.timers.add(() => {
            window.clearTimeout(id)
            resolve()
          })
        })
      setState('speaking')
      void playReply(steps, {
        cancelled: () => !run.live,
        speak: (t) => (settings.speak ? speakSession(run.session, t, voice) : pause(silentPauseMs(t))),
        pause,
        onStep: (i, step) => {
          if (step.kind === 'board') {
            setBoard({ key: `${run.session}-${i}`, title: step.title, lines: step.lines, shown: 0 })
          }
        },
        onLine: (i, shown) =>
          setBoard((b) => (b && b.key === `${run.session}-${i}` ? { ...b, shown } : b)),
        onCaption: (c) => setLineCaption(c),
      }).finally(() => {
        if (replyRef.current === run) {
          replyRef.current = null
          setState('idle')
          setLineCaption('')
        }
      })
    },
    [settings.speak, settings.ttsVoice, settings.accent, settings.ttsSpeed, stopReply],
  )

  // Audio levels drive the orb. Throttled so the page does not re-render 60 times a second.
  useEffect(() => {
    let last = 0
    return subscribeVoiceFrames((f) => {
      const now = performance.now()
      if (now - last < 60) return
      last = now
      setAmp(f.amp)
      setBands(f.bands)
    })
  }, [])

  // Leaving the page silences the tutor.
  useEffect(() => () => stopReply(), [stopReply])

  const stopMicTracks = () => {
    monitorStop.current?.()
    monitorStop.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setAmp(0)
    setPitch(0)
    setBands([])
  }

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (!settings.geminiKey) {
        setHarness(true)
        return
      }
      setErr(null)
      setDraft('')
      setTyping(false)
      stopReply()
      const userTurn: Turn = { id: `u-${Date.now()}`, role: 'student', text: trimmed }
      const tutorId = `t-${Date.now()}`
      setTurns((t) => [...t, userTurn, { id: tutorId, role: 'tutor', text: '', streaming: true }])
      setState('thinking')
      let full = ''
      try {
        for await (const chunk of streamTutorReply({
          apiKey: settings.geminiKey,
          model: settings.model,
          tutorName: 'Amina',
          student: settings.studentName,
          course: settings.courseName,
          notation: settings.notation,
          mode,
          history: history.current,
          userText: trimmed,
          files,
        })) {
          full += chunk
          const shown = full
          setTurns((t) => t.map((x) => (x.id === tutorId ? { ...x, text: shown } : x)))
        }
        history.current = [
          ...history.current,
          { role: 'user' as const, text: trimmed },
          { role: 'model' as const, text: full },
        ].slice(-16)
        setTurns((t) => t.map((x) => (x.id === tutorId ? { ...x, streaming: false, text: full } : x)))
        startReply(full)
      } catch (e) {
        const message = explainError(e)
        setErr(message)
        setState('error')
        setTurns((t) => t.filter((x) => x.id !== tutorId || x.text))
        toast(message)
      }
    },
    [files, mode, settings, toast, stopReply, startReply],
  )

  async function startMic() {
    setErr(null)
    stopReply()
    stopTutorVoice()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      streamRef.current = stream
      chunks.current = []
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      )
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      rec.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data)
      }
      recorder.start(200)
      monitorStop.current = startMicMonitor(stream, (frame) => {
        setAmp(frame.amp)
        setPitch(frame.pitch)
        setBands(frame.bands)
      })
      setState('listening')
    } catch (e) {
      setErr(explainError(e) || 'Microphone blocked. Type instead.')
      setTyping(true)
    }
  }

  async function stopMic() {
    const recorder = rec.current
    rec.current = null
    if (!recorder || recorder.state === 'inactive') {
      stopMicTracks()
      setState('idle')
      return
    }
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' }))
      recorder.stop()
    })
    stopMicTracks()
    setState('processing')
    setTranscribing(true)
    try {
      const text = await transcribeWithWhisper({ audio: blob, model: chosenModel })
      setTranscribing(false)
      setAsrInfo((prev) => ({ ...prev, state: 'ready', progress: 100 }))
      await ask(text)
    } catch (e) {
      setTranscribing(false)
      setErr(explainError(e))
      setAsrInfo(null)
      setState('idle')
      setTyping(true)
    }
  }

  function onDrag(e: DragEvent) {
    e.preventDefault()
    setDropOver(true)
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    setDropOver(false)
    if (e.dataTransfer.files.length) {
      try {
        await addFiles(e.dataTransfer.files)
        toast(`${e.dataTransfer.files.length} file(s) indexed`)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Upload failed')
      }
    }
  }

  const listening = state === 'listening'

  return (
    <div
      ref={root}
      className="relative h-dvh overflow-hidden bg-background"
      onDragOver={onDrag}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      {dropOver ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-background/80 border-2 border-dashed border-accent">
          <p className="serif text-3xl">Index into the course</p>
        </div>
      ) : null}

      {harness ? <SetupHarness onDone={() => setHarness(false)} /> : null}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <header className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 md:px-6 h-14">
        <div className="flex items-center gap-3 min-w-0">
          <span className="serif text-lg">Sabi</span>
          <span className="hidden sm:inline font-mono text-[11px] text-muted truncate">
            {settings.courseName} · {files.length} files
          </span>
        </div>
        <div className="flex items-center gap-1 text-[12px]">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'px-2 py-1 capitalize hidden md:inline',
                mode === m ? 'text-accent border-b border-accent' : 'text-muted',
              )}
            >
              {m}
            </button>
          ))}
          <button
            type="button"
            className={cn('px-2 py-1', settings.captions ? 'text-accent' : 'text-muted')}
            onClick={() => patchSettings({ captions: !settings.captions })}
            aria-pressed={settings.captions}
          >
            Captions
          </button>
          <Link to="/assess" className="px-2 py-1 text-muted hover:text-foreground hidden sm:inline">
            Assess
          </Link>
          <Link to="/library" className="px-2 py-1 text-muted hover:text-foreground">
            Files
          </Link>
          <button
            type="button"
            className="size-10 grid place-items-center text-muted hover:text-foreground"
            aria-label="Harness settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </header>

      <main className="h-full grid grid-rows-[1fr_auto] pt-14">
        <section
          className={cn(
            'min-h-0 px-4',
            showBoard
              ? 'grid lg:grid-cols-[140px_minmax(0,1fr)] gap-4 items-center'
              : 'grid place-items-center',
          )}
        >
          <div
            className={cn(
              'studio-orb grid gap-3 text-center',
              showBoard ? 'w-full max-w-[140px] mx-auto hidden lg:grid' : 'w-full max-w-[420px]',
            )}
          >
            <TutorOrb state={state} amplitude={amp} pitch={pitch} bands={bands} />
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted" aria-live="polite">
              {showBoard ? 'Board' : labelFor(state)}
            </p>
            {!showBoard && settings.captions ? (
              <div className="caption-clip min-h-[4.5rem] px-2">
                {caption ? (
                  <MathText
                    text={caption}
                    streaming={turns.at(-1)?.streaming}
                    className="serif text-left mx-auto text-[17px] md:text-[19px] leading-snug"
                  />
                ) : (
                  <p className="text-muted text-sm">Speak or type. Captions appear here.</p>
                )}
              </div>
            ) : null}
            {whisperNote ? (
              <p className="text-sm text-muted">{whisperNote}</p>
            ) : null}
            {err ? (
              <p className="text-sm text-danger break-words text-left max-w-prose mx-auto" role="alert">
                {err}
              </p>
            ) : null}
          </div>
          {showBoard && board ? (
            <div className="min-w-0 py-2">
              <Whiteboard
                title={board.title}
                lines={board.lines}
                shown={board.shown}
                writing={state === 'speaking' && board.shown < board.lines.length}
                onWipe={() => {
                  stopReply()
                  setState('idle')
                }}
                onClose={() => {
                  stopReply()
                  setBoard(null)
                  setState('idle')
                }}
              />
              {settings.captions && caption ? (
                <p className="serif text-center mt-3 text-[15px] text-muted max-w-2xl mx-auto">
                  {caption}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <footer className="studio-dock px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          {typing ? (
            <form
              className="mx-auto max-w-2xl mb-3"
              onSubmit={(e) => {
                e.preventDefault()
                void ask(draft)
              }}
            >
              <Textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask, explain, or write a derivation. $ for LaTeX."
                className="min-h-[88px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void ask(draft)
                  }
                }}
              />
            </form>
          ) : null}
          <div className="flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Type"
              aria-pressed={typing}
              onClick={() => setTyping((v) => !v)}
            >
              <Keyboard className="size-5" />
            </Button>
            <Button
              type="button"
              variant={listening ? 'danger' : 'primary'}
              size="mic"
              aria-label={listening ? 'Stop' : 'Speak'}
              onClick={() => (listening ? void stopMic() : void startMic())}
              className={cn(listening && 'animate-pulse')}
            >
              {listening ? <MicOff className="size-7" /> : <Mic className="size-7" />}
            </Button>
            {state === 'speaking' ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Stop voice"
                onClick={() => {
                  stopReply()
                  setState('idle')
                }}
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Transcript"
                aria-pressed={transcriptOpen}
                onClick={() => setTranscriptOpen((v) => !v)}
              >
                Aa
              </Button>
            )}
          </div>
          <p className="mt-2 text-center font-mono text-[11px] text-muted">
            {settings.notation}
            {files.length ? ` · ${files[0]?.name}` : ' · drop notes anywhere'}
          </p>
        </footer>
      </main>

      {transcriptOpen ? (
        <aside className="absolute right-0 top-14 bottom-0 w-full max-w-md border-l border-border bg-surface/95 backdrop-blur overflow-y-auto p-5 z-10">
          <div className="flex justify-between items-center mb-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Transcription</p>
            <button type="button" className="text-sm" onClick={() => setTranscriptOpen(false)}>
              Close
            </button>
          </div>
          {turns.length === 0 ? (
            <p className="text-muted text-sm">Nothing yet.</p>
          ) : (
            turns.map((t) => (
              <article key={t.id} className="py-3 border-b border-border">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                  {t.role === 'tutor' ? 'Amina' : 'You'}
                </p>
                <MathText text={t.text} streaming={t.streaming} className="mt-1" />
              </article>
            ))
          )}
        </aside>
      ) : null}
    </div>
  )
}

function labelFor(state: VoiceState) {
  const map: Record<VoiceState, string> = {
    idle: 'Ready',
    listening: 'Listening',
    processing: 'Transcribing',
    thinking: 'From your notes',
    speaking: 'Speaking',
    paused: 'Paused',
    error: 'Error',
  }
  return map[state]
}



