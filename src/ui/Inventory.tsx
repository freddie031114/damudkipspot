import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { adjustStock, deleteItems, updateItem } from '../data/changes'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { formatAud, parseMoney } from '../domain/money'
import { DEFAULT_NAMES } from '../lib/profile'
import { btnCls, ghostBtn } from './common'

export type View = ProfileId | 'all'
type SortKey = 'name' | 'qty' | 'market' | 'sticker' | 'value' | 'location'

const COLS = '28px minmax(160px,2.2fr) minmax(120px,1.3fr) 90px 64px 96px 96px 104px minmax(80px,1fr) 150px'

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
        className={`min-h-6 cursor-text truncate rounded px-1 hover:bg-indigo-500/10 ${align === 'right' ? 'text-right' : ''}`}
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
    <input autoFocus aria-label={label} className={`w-full rounded border border-indigo-500 bg-transparent px-1 ${align === 'right' ? 'text-right' : ''}`}
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const readOnly = view === 'all'

  const visible = useMemo(() => {
    const list = rows.filter((r) => (view === 'all' || r.item.profileId === view) && matchesSearch(r.item, search))
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
  }, [rows, view, search, sort])

  const totals = useMemo(() => ({
    units: visible.reduce((n, r) => n + r.qty, 0),
    value: visible.reduce((n, r) => n + r.marketValueCents, 0),
    known: visible.reduce((n, r) => n + r.knownCostCents, 0),
    unknown: visible.filter((r) => r.costUnknown).length,
  }), [visible])

  const parentRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: visible.length, getScrollElement: () => parentRef.current, estimateSize: () => 34, overscan: 12 })

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-4 border-b border-slate-300 px-4 py-1.5 text-sm dark:border-slate-700" aria-label="Totals">
        <span><strong>{visible.length}</strong> items</span>
        <span><strong>{totals.units}</strong> units</span>
        <span>Market value <strong>{formatAud(totals.value)}</strong></span>
        <span className="opacity-70">Known cost {formatAud(totals.known)}{totals.unknown > 0 && ` (${totals.unknown} items with no cost recorded)`}</span>
        {readOnly && <span className="ml-auto rounded bg-slate-200 px-2 py-0.5 dark:bg-slate-700">Combined view is read-only</span>}
        {!readOnly && selected.size > 0 && (
          <span className="ml-auto flex items-center gap-2">
            {selected.size} selected
            <button className={ghostBtn} onClick={() => {
              const items = rows.filter((r) => selected.has(r.item.id)).map((r) => r.item)
              apply(deleteItems(ctx(), items)); setSelected(new Set())
            }}>Delete</button>
          </span>
        )}
      </div>

      <div className="grid items-center gap-2 border-b border-slate-300 px-4 py-1.5 text-xs uppercase tracking-wide dark:border-slate-700" style={{ gridTemplateColumns: COLS }}>
        <input type="checkbox" aria-label="Select all" checked={allSelected} disabled={readOnly}
          onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.item.id)))} />
        {header('name', 'Name')}<span className="px-1">Set / #</span><span className="px-1">Lang · Cond</span>
        {header('qty', 'Qty', true)}{header('market', 'Market', true)}{header('sticker', 'Sticker', true)}{header('value', 'Value', true)}
        {header('location', 'Location')}<span className="px-1">Flags</span>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="inventory-scroll">
        {!ready && <p className="p-4">Loading stock…</p>}
        {ready && visible.length === 0 && <p className="p-4 opacity-70">{search ? 'No items match your search.' : 'No stock yet. Press N to add some.'}</p>}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const r = visible[v.index]!
            const it = r.item
            const flags = [r.oversold > 0 && `Oversold ${r.oversold}`, r.lowStock && 'Low', r.stalePrice && 'Stale', r.costUnknown && 'No cost'].filter(Boolean) as string[]
            return (
              <div key={it.id} role="row" className="group absolute left-0 grid w-full items-center gap-2 border-b border-slate-200 px-4 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                style={{ gridTemplateColumns: COLS, height: v.size, transform: `translateY(${v.start}px)` }}>
                <input type="checkbox" aria-label={`Select ${it.name}`} disabled={readOnly} checked={selected.has(it.id)}
                  onChange={() => { const s = new Set(selected); if (s.has(it.id)) s.delete(it.id); else s.add(it.id); setSelected(s) }} />
                <EditableCell label={`name of ${it.name}`} disabled={readOnly} initial={it.name}
                  display={<>{view === 'all' && <span className="mr-1 rounded bg-slate-200 px-1 text-xs dark:bg-slate-700">{DEFAULT_NAMES[it.profileId]}</span>}{it.name}</>}
                  onCommit={(v) => run(() => updateItem(ctx(), it, { name: v.trim() }))} />
                <div className="truncate px-1 opacity-80">{[it.setName, it.cardNumber, it.variant].filter(Boolean).join(' · ')}</div>
                <div className="truncate px-1 opacity-80">{[it.language, it.condition || it.grade && `${it.gradingCompany} ${it.grade}`].filter(Boolean).join(' · ')}</div>
                <EditableCell label={`quantity of ${it.name}`} align="right" disabled={readOnly} initial={String(r.qty)} display={r.qty}
                  onCommit={(v) => {
                    const target = Number(v)
                    if (!Number.isInteger(target) || target < 0) return notify('Quantity must be a whole number, zero or more', true)
                    const delta = target - r.qty
                    if (delta !== 0) apply(adjustStock(ctx(), it, delta, delta > 0 ? 'found' : 'count correction', 'inline edit'))
                  }} />
                <EditableCell label={`market price of ${it.name}`} align="right" disabled={readOnly} initial={(it.marketPriceCents / 100).toFixed(2)} display={formatAud(it.marketPriceCents)}
                  onCommit={(v) => { const m = money(v); if (m === null || m === 'bad') return notify('Enter a valid market price', true); run(() => updateItem(ctx(), it, { marketPriceCents: m })) }} />
                <EditableCell label={`sticker of ${it.name}`} align="right" disabled={readOnly} initial={it.stickerOverrideCents === null ? '' : (it.stickerOverrideCents / 100).toFixed(2)}
                  display={<span title={it.stickerOverrideCents !== null ? 'Manual sticker override' : 'Market x 1.1'}>{formatAud(r.sticker)}{it.stickerOverrideCents !== null && '*'}</span>}
                  onCommit={(v) => { const m = money(v); if (m === 'bad') return notify('Enter a valid sticker price, or leave blank to use market x 1.1', true); run(() => updateItem(ctx(), it, { stickerOverrideCents: m })) }} />
                <div className="px-1 text-right">{formatAud(r.marketValueCents)}</div>
                <EditableCell label={`location of ${it.name}`} disabled={readOnly} initial={it.location} display={it.location || <span className="opacity-40">—</span>}
                  onCommit={(v) => run(() => updateItem(ctx(), it, { location: v.trim() }))} />
                <div className="flex items-center gap-1 truncate text-xs">
                  {flags.map((f) => <span key={f} className="rounded bg-amber-500/20 px-1 text-amber-700 dark:text-amber-300">{f}</span>)}
                  <button className={`${btnCls} ml-auto !px-2 !py-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100`} aria-label={`Sell ${it.name}`} disabled={r.qty < 1} onClick={() => onSell(r)}>Sell</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
