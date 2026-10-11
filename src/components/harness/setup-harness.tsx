import { useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pingGemini } from '@/lib/gemini/client'
import { useAppState } from '@/lib/store'
import { cn } from '@/lib/utils'

gsap.registerPlugin(useGSAP)

export function SetupHarness({ onDone }: { onDone: () => void }) {
  const { settings, patchSettings, files, addFiles } = useAppState()
  const [step, setStep] = useState(0)
  const [key, setKey] = useState(settings.geminiKey)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.from('.harness-card', { y: 18, opacity: 0, duration: 0.45, ease: 'power2.out' })
    },
    { scope: panel, dependencies: [step] },
  )

  async function verify() {
    setBusy(true)
    setErr(null)
    try {
      await pingGemini(key.trim(), settings.model)
      patchSettings({ geminiKey: key.trim() })
      setStep(1)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach Gemini')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-background/95 px-4">
      <div ref={panel} className="harness-card w-full max-w-lg border border-border bg-surface p-6 md:p-8">
        <p className="font-mono text-[11px] tracking-[0.2em] text-accent">HARNESS {step + 1} / 2</p>
        {step === 0 ? (
          <div className="mt-4 grid gap-4">
            <h1 className="serif text-3xl">Gemini key</h1>
            <p className="text-sm text-muted">
              Stored only on this device. Get one from Google AI Studio.
            </p>
            <label className="grid gap-2 text-sm">
              <span className="text-muted">API key</span>
              <div className="flex gap-2">
                <Input
                  type={show ? 'text' : 'password'}
                  value={key}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="AIza…"
                  onChange={(e) => setKey(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => setShow((v) => !v)}>
                  {show ? 'Hide' : 'Show'}
                </Button>
              </div>
            </label>
            {err ? (
              <p className="text-sm text-danger" role="alert">
                {err}
              </p>
            ) : null}
            <div className="flex justify-between items-center pt-2">
              <a
                className="text-sm text-muted hover:text-foreground"
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Open AI Studio
              </a>
              <Button type="button" disabled={busy || key.trim().length < 20} onClick={() => void verify()}>
                {busy ? 'Checking…' : 'Connect'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            <h1 className="serif text-3xl">Notes</h1>
            <p className="text-sm text-muted">PDF, slides, board photos. Optional — you can add more inside.</p>
            <label
              className={cn(
                'grid place-items-center min-h-40 border border-dashed border-border cursor-pointer px-4 py-8 text-center',
                'hover:border-accent/60',
              )}
            >
              <input
                type="file"
                className="sr-only"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files)
                }}
              />
              <span>Drop or choose files</span>
              <span className="text-sm text-muted mt-1">{files.length} in the knowledge base</span>
            </label>
            <ul className="text-sm grid gap-1 max-h-28 overflow-auto">
              {files.map((f) => (
                <li key={f.id} className="flex justify-between gap-3">
                  <span className="truncate">{f.name}</span>
                  <span className="font-mono text-muted">{Math.round(f.size / 1024)} kb</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  patchSettings({ setupDone: true, geminiKey: key.trim() || settings.geminiKey })
                  onDone()
                }}
              >
                Skip
              </Button>
              <Button
                type="button"
                onClick={() => {
                  patchSettings({ setupDone: true, geminiKey: key.trim() || settings.geminiKey })
                  onDone()
                }}
              >
                Enter studio
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

