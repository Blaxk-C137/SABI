import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pingGemini } from '@/lib/gemini/client'
import { FREE_CHAT_MODELS, isFreeChatModel } from '@/lib/gemini/models'
import { getHealth, type AsrInfo, type TtsInfo } from '@/lib/api'
import { explainError } from '@/lib/debug'
import { useAppState } from '@/lib/store'
import { useToast } from '@/components/ui/toast'
import { playSample as speakSample } from '@/lib/voice/tutor-speak'

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, patchSettings, files, addFiles, deleteFile, theme, setTheme } = useAppState()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [asr, setAsr] = useState<AsrInfo | null>(null)
  const [tts, setTts] = useState<TtsInfo | null>(null)
  // The model list lives on the server; ask for it rather than keeping a second
  // copy here that could drift from what the backend will actually load.
  useEffect(() => {
    if (!open) return
    getHealth()
      .then((h) => {
        setAsr(h.asr)
        setTts(h.tts ?? null)
      })
      .catch(() => undefined)
  }, [open])
  if (!open) return null

  const model = isFreeChatModel(settings.model) ? settings.model : FREE_CHAT_MODELS[0].id

  const asrModels = asr?.models ?? []
  // A saved id the server no longer offers shows as the default, so the select
  // always displays a model that will really be loaded.
  const selectedAsr = asrModels.some((m) => m.id === settings.asrModel)
    ? settings.asrModel
    : (asr?.defaultModel ?? asrModels[0]?.id ?? '')

  return (
    <div className="fixed inset-0 z-30">
      <button className="absolute inset-0 bg-black/50" aria-label="Close settings" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6">
        <header className="flex items-center justify-between">
          <h2 className="serif text-2xl">Harness</h2>
          <button type="button" className="text-sm text-muted hover:text-foreground" onClick={onClose}>
            Close
          </button>
        </header>

        <section className="mt-8 grid gap-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Gemini · free tier</p>
          <Input
            type="password"
            value={settings.geminiKey}
            placeholder="API key"
            onChange={(e) => patchSettings({ geminiKey: e.target.value })}
          />
          <label className="text-sm text-muted grid gap-1">
            Chat model
            <select
              className="h-11 bg-elevated border border-border px-3 text-foreground"
              value={model}
              onChange={(e) => patchSettings({ model: e.target.value })}
            >
              {FREE_CHAT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-muted">
            Flash / Flash-Lite only, all free tier. Pro, TTS, Live and image models are not used.
            The 2.5 entries work only if your key has used them before — Google limits them to past
            users — so a fresh key falls through to the 3.x models.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !settings.geminiKey}
            onClick={async () => {
              setBusy(true)
              try {
                await pingGemini(settings.geminiKey, model)
                toast('Gemini connected')
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Failed')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Checking…' : 'Test key'}
          </Button>
        </section>

        <section className="mt-8 grid gap-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Listening · Whisper</p>
          {asrModels.length ? (
            <label className="text-sm text-muted grid gap-1">
              Model
              <select
                className="h-11 bg-elevated border border-border px-3 text-foreground"
                value={selectedAsr}
                onChange={(e) => patchSettings({ asrModel: e.target.value })}
              >
                {asrModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="text-[12px] text-muted">
            Small transcribes accurately but slowly — about eight seconds a sentence on a laptop
            CPU, and only the model size changes that. Base is roughly three times faster and
            mishears technical words, so it may write “Q minus double U” for “Q minus W”. Switching
            reloads the model once.
          </p>
          <p className="text-[12px] text-muted">
            Student speech is transcribed with Whisper by the Sabi backend on this machine — not
            Gemini, and not your browser. Models are installed by <code className="mx-1">npm install</code>
            (Piper and Whisper small); run <code className="mx-1">npm run models:all</code> for base and
            tiny. The app never downloads on its own — a missing model is reported here.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const health = await getHealth()
                const state = health.asr.state
                toast(
                  state === 'ready'
                    ? 'Whisper small ready'
                    : state === 'loading'
                      ? `Loading… ${Math.round(health.asr.progress)}%`
                      : state === 'error'
                        ? (health.asr.error ?? 'Voice backend error')
                        : 'Backend is up. Model loads on first use.',
                )
              } catch (e) {
                toast(explainError(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Checking…' : 'Check voice backend'}
          </Button>
        </section>

        <section className="mt-8 grid gap-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Speaking · Piper voice</p>
          <label className="text-sm text-muted grid gap-1">
            Voice
            <select
              className="h-11 bg-elevated border border-border px-3 text-foreground"
              value={settings.ttsVoice}
              onChange={(e) => patchSettings({ ttsVoice: e.target.value })}
            >
              <option value="">Auto for accent ({tts?.defaultVoice ?? 'en_GB-jenny_dioco-medium'})</option>
              {(tts?.voices ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-muted grid gap-1">
            Speed · {settings.ttsSpeed.toFixed(2)}×
            <input
              type="range"
              min={0.75}
              max={1.25}
              step={0.05}
              value={settings.ttsSpeed}
              onChange={(e) => patchSettings({ ttsSpeed: Number(e.target.value) })}
            />
          </label>
          <p className="text-[12px] text-muted">
            Piper is a neural voice that runs on this machine, so it sounds like a person rather
            than the browser. Piper has no Nigerian voice: Nigerian and Ghanaian English use the
            closest British voice. Formulas are read in words, never as symbols. Changing the voice
            takes effect on the next reply. To use your own Piper voice, see "Custom voices" in the
            README.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await speakSample(settings.ttsVoice, settings.accent, settings.ttsSpeed)
              } catch (e) {
                toast(explainError(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Play a sample
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.speak}
              onChange={(e) => patchSettings({ speak: e.target.checked })}
            />
            Speak replies
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.captions}
              onChange={(e) => patchSettings({ captions: e.target.checked })}
            />
            Show transcription
          </label>
        </section>

        <section className="mt-8 grid gap-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Course</p>
          <Input
            value={settings.courseName}
            onChange={(e) => patchSettings({ courseName: e.target.value })}
          />
          <Input
            value={settings.notation}
            onChange={(e) => patchSettings({ notation: e.target.value })}
          />
          <Input
            value={settings.studentName}
            onChange={(e) => patchSettings({ studentName: e.target.value })}
          />
        </section>

        <section className="mt-8 grid gap-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Materials</p>
          <input
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files).then(() => toast('Indexed'))
            }}
          />
          <ul className="grid gap-2 text-sm">
            {files.map((f) => (
              <li key={f.id} className="flex justify-between gap-3 border-b border-border py-2">
                <span className="truncate">{f.name}</span>
                <button type="button" className="text-danger" onClick={() => void deleteFile(f.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>

        <button
          type="button"
          className="mt-10 text-sm text-muted hover:text-foreground"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? 'Paper theme' : 'Night theme'}
        </button>
      </aside>
    </div>
  )
}

