import { Link } from 'react-router-dom'
import { useAppState } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty'

export function Library() {
  const { files, addFiles, deleteFile, settings, patchSettings } = useAppState()
  return (
    <div className="min-h-dvh bg-background px-5 py-8 md:px-10 max-w-3xl mx-auto grid gap-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <Link to="/" className="serif text-xl">
            Sabi
          </Link>
          <h1 className="serif text-4xl mt-3">Materials</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/assess" className="inline-flex h-11 items-center border border-border px-4">
            Assess
          </Link>
          <Link to="/" className="inline-flex h-11 items-center bg-accent text-accent-fg px-4">
            Tutor
          </Link>
        </div>
      </header>

      <section className="grid gap-3">
        <label className="text-sm text-muted">
          Course
          <input
            className="mt-1 h-11 w-full bg-elevated border border-border px-3 text-foreground"
            value={settings.courseName}
            onChange={(e) => patchSettings({ courseName: e.target.value })}
          />
        </label>
        <label className="text-sm text-muted">
          Notation
          <input
            className="mt-1 h-11 w-full bg-elevated border border-border px-3 eq text-foreground"
            value={settings.notation}
            onChange={(e) => patchSettings({ notation: e.target.value })}
          />
        </label>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted">Knowledge base</h2>
          <label className="text-sm text-accent cursor-pointer">
            Add files
            <input
              type="file"
              multiple
              className="sr-only"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files)
              }}
            />
          </label>
        </div>
        {files.length === 0 ? (
          <EmptyState
            title="No notes yet"
            body="Drop PDFs or board photos. The tutor reads them through Gemini."
            action={
              <Button type="button" variant="outline" onClick={() => document.querySelector<HTMLInputElement>('input[type=file]')?.click()}>
                Upload
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {files.map((f) => (
              <li key={f.id} className="py-3 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate">{f.name}</p>
                  <p className="text-sm text-muted">{f.mime} · {Math.round(f.size / 1024)} kb</p>
                </div>
                <button type="button" className="text-sm text-danger" onClick={() => void deleteFile(f.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

