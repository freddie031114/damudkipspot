import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useStore } from '../data/store'
import { slabLabel } from '../domain/grade'
import { formatAud } from '../domain/money'
import { DEFAULT_NAMES } from '../lib/profile'
import { BulkChip } from './Inventory'
import { Icon } from './icons'
import { useUi } from './UiContext'

type SortKey = 'value' | 'name' | 'qty' | 'market' | 'sticker'
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'value', label: 'Highest value' }, { id: 'name', label: 'Name A–Z' }, { id: 'qty', label: 'Most in stock' },
  { id: 'market', label: 'Market price' }, { id: 'sticker', label: 'Sticker price' },
]
const ROW = 78

const sortValue = (r: InventoryRow, k: SortKey): string | number =>
  k === 'name' ? r.item.name.toLowerCase() : k === 'qty' ? r.qty : k === 'market' ? r.item.marketPriceCents : k === 'sticker' ? r.sticker : r.marketValueCents

/** The phone version of the inventory: a searchable list of cards instead of a wide table. */
export function MobileInventory() {
  const { rows, ready } = useStore()
  const { view, search, setSearch, openItem, openSell, openImport, openAdd } = useUi()
  const [sort, setSort] = useState<SortKey>('value')
  const [onlySticker, setOnlySticker] = useState(false)

  const visible = useMemo(() => {
    const list = rows.filter((r) => r.item.kind !== 'bulk' && (view === 'all' || r.item.profileId === view) && matchesSearch(r.item, search) && (!onlySticker || r.needsSticker))
    const desc = sort !== 'name'
    return list.sort((a, b) => {
      const x = sortValue(a, sort), y = sortValue(b, sort)
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1) || a.item.name.localeCompare(b.item.name)
    })
  }, [rows, view, search, sort, onlySticker])

  const totals = useMemo(() => ({
    units: visible.reduce((n, r) => n + r.qty, 0),
    market: visible.reduce((n, r) => n + r.marketValueCents, 0),
    sticker: visible.reduce((n, r) => n + r.qty * r.sticker, 0),
    resticker: rows.filter((r) => (view === 'all' || r.item.profileId === view) && r.needsSticker).length,
  }), [visible, rows, view])

  const parentRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: visible.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW, overscan: 10 })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
        <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50">{Icon.search(18)}</span>
          <input type="search" aria-label="Search inventory" placeholder="Search name, number, set…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-xl border border-transparent bg-hover pl-10 pr-10 outline-none placeholder:opacity-60 focus:border-brand focus:bg-surface" />
          {search && <button aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-xl opacity-60">×</button>}
        </div>
        <button aria-label="Add stock" onClick={openAdd} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg shadow-sm active:scale-95">{Icon.plus(22)}</button>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 shrink-0 rounded-full border border-line bg-surface px-3 text-sm">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {(totals.resticker > 0 || onlySticker) && (
            <button aria-pressed={onlySticker} onClick={() => setOnlySticker(!onlySticker)}
              className={`h-9 shrink-0 rounded-full border px-3 text-sm ${onlySticker ? 'border-accent bg-accent/20 font-semibold text-accent-ink' : 'border-line text-accent-ink'}`}>
              Needs re-sticker ({totals.resticker})
            </button>
          )}
        </div>
        <p className="px-1 text-xs opacity-70">{visible.length} items · {totals.units} units</p>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-card" aria-label="Totals">
          <span className="flex flex-col leading-tight"><strong className="text-[15px]">{formatAud(totals.market)}</strong><span className="text-[10px] uppercase tracking-wider opacity-60">Market</span></span>
          <span className="flex flex-col leading-tight"><strong className="text-[15px]">{formatAud(totals.sticker)}</strong><span className="text-[10px] uppercase tracking-wider opacity-60">Sticker</span></span>
          <BulkChip profile={view} short />
        </div>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto border-t border-line bg-surface" data-testid="inventory-scroll">
        {!ready && <p className="p-4">Loading stock…</p>}
        {ready && visible.length === 0 && (
          <p className="p-4 opacity-70">{search || onlySticker ? 'Nothing matches.' : <>No stock yet. Tap + to add some, or <button className="underline" onClick={openImport}>import your spreadsheet</button>.</>}</p>
        )}
        <div style={{ height: virt.getTotalSize() + 88, position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const r = visible[v.index]!
            const it = r.item
            const slab = slabLabel(it)
            const flags = [r.oversold > 0 && `Oversold ${r.oversold}`, r.lowStock && 'Low', r.needsSticker && 'Re-sticker', r.stalePrice && 'Stale price'].filter(Boolean) as string[]
            return (
              <div key={it.id} role="row" onClick={() => openItem(it.id)}
                className="absolute left-0 flex w-full items-center gap-3 border-b border-line/70 px-3 active:bg-hover"
                style={{ height: v.size, transform: `translateY(${v.start}px)` }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {view === 'all' && <span className={`shrink-0 rounded-full px-1.5 text-[10px] font-semibold ${it.profileId === 'p1' ? 'bg-brand/15 text-brand' : 'bg-accent/20 text-accent-ink'}`}>{DEFAULT_NAMES[it.profileId]}</span>}
                    <span className="truncate text-[15px] font-medium">{it.name}</span>
                    {slab && <span className="shrink-0 rounded bg-chip px-1.5 text-[11px] font-semibold">{slab}</span>}
                  </div>
                  <div className="truncate text-xs opacity-60">{[it.cardNumber, !slab && it.condition, it.variant, it.setName].filter(Boolean).join(' · ') || '—'}</div>
                  {flags.length > 0 && (
                    <div className="mt-0.5 flex gap-1 overflow-hidden">
                      {flags.map((f) => <span key={f} className="shrink-0 rounded-full bg-accent/15 px-1.5 text-[10px] font-medium text-accent-ink">{f}</span>)}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right leading-tight">
                  <div className="text-base font-semibold">{formatAud(r.sticker)}</div>
                  <div className="text-[11px] opacity-60">mkt {formatAud(it.marketPriceCents)}</div>
                  <div className={`text-xs ${r.qty === 0 ? 'opacity-50' : 'font-medium'}`}>{r.qty === 0 ? 'Out of stock' : `×${r.qty}`}</div>
                </div>
                <button aria-label={`Sell ${it.name}`} disabled={r.qty < 1} onClick={(e) => { e.stopPropagation(); openSell(r) }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-[#2b1600] shadow-sm active:scale-95 disabled:opacity-30">{Icon.cash(20)}</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
