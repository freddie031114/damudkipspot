import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { adjustStock, combineChanges, deleteItems, markStickered, updateItem } from '../data/changes'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { formatAud, parseMoney } from '../domain/money'
import { btnCls, ghostBtn } from './common'
import { SavedViews } from './SavedViews'
import { useUi } from './UiContext'

export type View = ProfileId
type SortKey = 'name' | 'qty' | 'market' | 'sticker' | 'value' | 'location'

// One "Card" column holds the name plus its number, set, variant, language, condition and flags.
const COLS = '24px minmax(280px,6fr) 52px 84px 84px 92px minmax(72px,1fr) 104px'

function EditableCell({ display, initial, onCommit, disabled, align = 'left', label }: {
  display: ReactNode; initial: string; onCommit: (v: string) => void; disabled?: boolean; align?: 'left' | 'right'; label: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  if (disabled) return <div className={`truncate px-1 ${align === 'right' ? 'text-right' : ''}`}>{display}</div>
  if (!editing) {
    return (
      <div role="button" tabIndex={0} aria-label={`Edit ${label}`}
        className={`min-h-6 cursor-text truncate rounded px-1 hover:bg-brand/10 ${align === 'right' ? 'text-right' : ''}`}
        onClick={() => { setValue(initial); done.current = false; setEditing(true) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { setValue(initial); done.current = false; setEditing(true) } }}>
        {display}
      </div>
    )
  }
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    setEditing(false)
    if (commit) onCommit(value)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false) }
  }
  return (
    <input autoFocus aria-label={label} className={`w-full rounded border border-brand bg-transparent px-1 ${align === 'right' ? 'text-right' : ''}`}
      value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} onBlur={() => finish(true)}
      onFocus={(e) => e.currentTarget.select()} />
  )
}

export function Inventory({ view, search, onSell, selected, setSelected }: {
  view: View; search: string; onSell: (r: InventoryRow) => void
  selected: Set<string>; setSelected: (s: Set<string>) => void
}) {
  const { rows, apply, notify, ready } = useStore()
  const ctx = useChangeCtx()
  const { openItem, openImport, setView, setSearch } = useUi()
  const [moveTo, setMoveTo] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 })
  const [onlySticker, setOnlySticker] = useState(false)

  const visible = useMemo(() => {
    const list = rows.filter((r) => r.item.profileId === view && matchesSearch(r.item, search) && (!onlySticker || r.needsSticker))
    const val = (r: InventoryRow): string | number => {
      switch (sort.key) {
        case 'name': return r.item.name.toLowerCase()
        case 'qty': return r.qty
        case 'market': return r.item.marketPriceCents
        case 'sticker': return r.sticker
        case 'value': return r.marketValueCents
        case 'location': return r.item.location.toLowerCase()
      }
    }
    return list.sort((a, b) => {
      const x = val(a), y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.item.name.localeCompare(b.item.name)
    })
  }, [rows, view, search, sort, onlySticker])

  const totals = useMemo(() => ({
    units: visible.reduce((n, r) => n + r.qty, 0),
    value: visible.reduce((n, r) => n + r.marketValueCents, 0),
    sticker: visible.reduce((n, r) => n + r.qty * r.sticker, 0),
    known: visible.reduce((n, r) => n + r.knownCostCents, 0),
    unknown: visible.filter((r) => r.costUnknown).length,
    resticker: rows.filter((r) => r.item.profileId === view && r.needsSticker).length,
  }), [visible])

  const parentRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: visible.length, getScrollElement: () => parentRef.current, estimateSize: () => 30, overscan: 12 })

  const run = (fn: () => ReturnType<typeof updateItem>) => {
    try { apply(fn()) } catch (e) { notify((e as Error).message, true) }
  }
  const money = (v: string): number | null | 'bad' => {
    if (v.trim() === '') return null
    const c = parseMoney(v)
    return c === null ? 'bad' : c
  }

  function header(key: SortKey, label: string, right = false) {
    const active = sort.key === key
    return (
      <button className={`px-1 font-semibold ${right ? 'text-right' : 'text-left'}`} aria-label={`Sort by ${label}`}
        onClick={() => setSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {label}{active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    )
  }

  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.item.id))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto p-4 md:p-6">
     <div className="flex min-h-0 min-w-[820px] flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-line px-5 py-3 text-sm" aria-label="Totals">
        {([
          [String(visible.length), 'items'],
          [String(totals.units), 'units'],
          [formatAud(totals.value), 'Market value'],
          [formatAud(totals.sticker), 'Sticker value'],
        ] as const).map(([v, l]) => (
          <span key={l} className="flex flex-col leading-tight"><strong className="text-lg font-semibold">{v}</strong><span className="text-[11px] uppercase tracking-wider opacity-60">{l}</span></span>
        ))}
        <span className="flex flex-col leading-tight opacity-80"><strong className="text-lg font-semibold">{formatAud(totals.known)}</strong><span className="text-[11px] uppercase tracking-wider opacity-60">Known cost{totals.unknown > 0 && ` · ${totals.unknown} without`}</span></span>
        {(totals.resticker > 0 || onlySticker) && (
          <label className="flex items-center gap-1 text-accent-ink"><input type="checkbox" checked={onlySticker} onChange={(e) => setOnlySticker(e.target.checked)} /> Needs re-sticker ({totals.resticker})</label>
        )}
        <SavedViews current={{ view, search, sortKey: sort.key, sortDir: sort.dir, onlySticker }}
          onApply={(v) => { setView(v.view); setSearch(v.search); setSort({ key: v.sortKey as SortKey, dir: v.sortDir }); setOnlySticker(v.onlySticker) }} />
        {selected.size > 0 && (
          <span className="ml-auto flex items-center gap-2">
            {selected.size} selected
            <button className={ghostBtn} onClick={() => {
              const items = rows.filter((r) => selected.has(r.item.id)).map((r) => r.item)
              apply(deleteItems(ctx(), items)); setSelected(new Set())
            }}>Delete</button>
            <button className={ghostBtn} onClick={() => {
              const chosen = rows.filter((r) => selected.has(r.item.id))
              apply(markStickered(ctx(), chosen)); setSelected(new Set())
            }}>Mark stickered</button>
            <input className="w-36 rounded border border-line bg-transparent px-1 py-0.5" aria-label="Move selected to location" placeholder="Move to location ↵" value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !moveTo.trim()) return
                const chosen = rows.filter((r) => selected.has(r.item.id))
                apply(combineChanges(`Moved ${chosen.length} item(s) to ${moveTo.trim()}`, chosen.map((r) => updateItem(ctx(), r.item, { location: moveTo.trim() }))))
                setMoveTo(''); setSelected(new Set())
              }} />
          </span>
        )}
      </div>

      <div className="grid items-center gap-2 border-b border-line bg-hover/50 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink/65" style={{ gridTemplateColumns: COLS }}>
        <input type="checkbox" aria-label="Select all" checked={allSelected}
          onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.item.id)))} />
        {header('name', 'Card')}
        {header('qty', 'Qty', true)}{header('market', 'Market', true)}{header('sticker', 'Sticker', true)}{header('value', 'Value', true)}
        {header('location', 'Location')}<span className="sr-only">Actions</span>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="inventory-scroll">
        {!ready && <p className="p-4">Loading stock…</p>}
        {ready && visible.length === 0 && <p className="p-4 opacity-70">{search ? 'No items match your search.' : <>No stock yet. Press <kbd>N</kbd> to add some, or <button className="underline" onClick={openImport}>import your spreadsheet</button>.</>}</p>}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const r = visible[v.index]!
            const it = r.item
            const flags = [r.oversold > 0 && `Oversold ${r.oversold}`, r.lowStock && 'Low', r.needsSticker && 'Re-sticker', r.stalePrice && 'Stale'].filter(Boolean) as string[]
            return (
              <div key={it.id} role="row" className="group absolute left-0 grid w-full items-center gap-2 border-b border-line/60 px-4 text-[13px] transition-colors hover:bg-hover/70"
                style={{ gridTemplateColumns: COLS, height: v.size, transform: `translateY(${v.start}px)` }}>
                <input type="checkbox" aria-label={`Select ${it.name}`} checked={selected.has(it.id)}
                  onChange={() => { const s = new Set(selected); if (s.has(it.id)) s.delete(it.id); else s.add(it.id); setSelected(s) }} />
                <div className="flex min-w-0 items-center gap-2">
                  <div className="max-w-[55%] shrink-0 font-medium">
                    <EditableCell label={`name of ${it.name}`} initial={it.name} display={it.name}
                      onCommit={(v) => run(() => updateItem(ctx(), it, { name: v.trim() }))} />
                  </div>
                  {it.gradingCompany && it.grade && <span className="shrink-0 rounded bg-chip px-1.5 text-[11px] font-semibold">{it.gradingCompany} {it.grade}</span>}
                  <span className="min-w-0 flex-1 cursor-pointer truncate text-xs opacity-60 hover:opacity-100" title="Open details" onClick={() => openItem(it.id)}>
                    {[it.cardNumber, it.setName, it.variant, it.language !== 'EN' && it.language, it.condition].filter(Boolean).join(' · ')}
                  </span>
                  {flags.map((f) => <span key={f} className="shrink-0 rounded-full bg-accent/15 px-2 text-[11px] font-medium text-accent-ink">{f}</span>)}
                </div>
                <EditableCell label={`quantity of ${it.name}`} align="right" initial={String(r.qty)} display={r.qty}
                  onCommit={(v) => {
                    const target = Number(v)
                    if (!Number.isInteger(target) || target < 0) return notify('Quantity must be a whole number, zero or more', true)
                    const delta = target - r.qty
                    if (delta !== 0) apply(adjustStock(ctx(), it, delta, delta > 0 ? 'found' : 'count correction', 'inline edit'))
                  }} />
                <EditableCell label={`market price of ${it.name}`} align="right" initial={(it.marketPriceCents / 100).toFixed(2)} display={formatAud(it.marketPriceCents)}
                  onCommit={(v) => { const m = money(v); if (m === null || m === 'bad') return notify('Enter a valid market price', true); run(() => updateItem(ctx(), it, { marketPriceCents: m })) }} />
                <EditableCell label={`sticker of ${it.name}`} align="right" initial={it.stickerOverrideCents === null ? '' : (it.stickerOverrideCents / 100).toFixed(2)}
                  display={<span title={it.stickerOverrideCents !== null ? 'Manual sticker override' : 'Market x 1.1'}>{formatAud(r.sticker)}{it.stickerOverrideCents !== null && '*'}</span>}
                  onCommit={(v) => { const m = money(v); if (m === 'bad') return notify('Enter a valid sticker price, or leave blank to use market x 1.1', true); run(() => updateItem(ctx(), it, { stickerOverrideCents: m })) }} />
                <div className="px-1 text-right">{formatAud(r.marketValueCents)}</div>
                <EditableCell label={`location of ${it.name}`} initial={it.location} display={it.location || <span className="opacity-40">—</span>}
                  onCommit={(v) => run(() => updateItem(ctx(), it, { location: v.trim() }))} />
                <div className="flex items-center justify-end gap-1 text-xs">
                  <button className="rounded px-1.5 underline opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Open ${it.name}`} onClick={() => openItem(it.id)}>Open</button>
                  <button className={`${btnCls} !px-2 !py-0.5 !text-xs opacity-0 group-hover:opacity-100 focus:opacity-100`} aria-label={`Sell ${it.name}`} disabled={r.qty < 1} onClick={() => onSell(r)}>Sell</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
     </div>
    </div>
  )
}
