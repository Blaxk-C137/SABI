import type { Material } from '@/lib/course/types'

const kindLabel: Record<Material['kind'], string> = {
  pdf: 'PDF',
  slides: 'Slides',
  notes: 'Notes',
  image: 'Image',
  outline: 'Outline',
}

export function MaterialList({ materials }: { materials: Material[] }) {
  if (materials.length === 0) {
    return (
      <p className="text-muted text-sm">No materials in this course yet.</p>
    )
  }
  return (
    <ul className="divide-y divide-border">
      {materials.map((m) => (
        <li key={m.id} className="py-4 flex items-start justify-between gap-4">
          <div>
            <p>{m.title}</p>
            <p className="text-sm text-muted mt-1">
              {kindLabel[m.kind]}
              {m.pages ? ` · ${m.pages} pp` : ''} · {m.addedAt}
              {m.note ? ` · ${m.note}` : ''}
            </p>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {m.status}
          </span>
        </li>
      ))}
    </ul>
  )
}

