import { useState } from 'react'
import { ghostBtn } from './common'

export interface SavedView {
  name: string
  view: 'p1' | 'p2'
  search: string
  sortKey: string
  sortDir: 1 | -1
  onlySticker: boolean
}

const KEY = 'damudkipspot.savedViews'

function load(): SavedView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw)
      ? (raw as SavedView[]).filter((v) => v && typeof v.name === 'string').map((v) => (v.view === 'p1' || v.view === 'p2' ? v : { ...v, view: 'p1' as const }))
      : []
  } catch {
    return []
  }
}

function store(v: SavedView[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable: views last for this session only */
  }
}

/** Saved filters and sort orders, kept on this laptop. */
export function SavedViews({ current, onApply }: { current: Omit<SavedView, 'name'>; onApply: (v: SavedView) => void }) {
  const [views, setViews] = useState<SavedView[]>(load)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const save = () => {
    const n = name.trim()
    if (!n) return
    const next = [...views.filter((v) => v.name !== n), { ...current, name: n }]
    setViews(next)
    store(next)
    setName('')
    setNaming(false)
  }
  const remove = (n: string) => {
    const next = views.filter((v) => v.name !== n)
    setViews(next)
    store(next)
  }

  return (
    <span className="flex items-center gap-1" aria-label="Saved views">
      {views.length > 0 && (
        <select aria-label="Saved views" className="rounded-lg border border-line bg-transparent px-2 py-1 text-xs" value=""
          onChange={(e) => { const v = views.find((x) => x.name === e.target.value); if (v) onApply(v) }}>
          <option value="">Saved views…</option>
          {views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
      )}
      {naming ? (
        <>
          <input autoFocus className="w-32 rounded border border-line bg-transparent px-1 py-0.5" aria-label="View name" placeholder="Name this view" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') { e.stopPropagation(); setNaming(false) } }} />
          <button className={ghostBtn} onClick={save}>Save</button>
        </>
      ) : (
        <button className="rounded-lg border border-line px-2.5 py-1 text-xs transition-colors hover:bg-hover" onClick={() => setNaming(true)}>Save view</button>
      )}
      {views.length > 0 && !naming && (
        <select aria-label="Delete a saved view" className="w-6 rounded border border-line bg-transparent py-0.5" value="" onChange={(e) => { if (e.target.value) remove(e.target.value) }}>
          <option value="">×</option>
          {views.map((v) => <option key={v.name} value={v.name}>Delete {v.name}</option>)}
        </select>
      )}
    </span>
  )
}
