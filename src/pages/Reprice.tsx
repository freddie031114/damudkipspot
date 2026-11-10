import { useMemo, useRef, useState } from 'react'
import { updateItem } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import { formatAud, parseMoney } from '../domain/money'
import { useIsMobile } from '../lib/useMedia'
import { btnCls } from '../ui/common'
import { fmtDate } from '../ui/format'
import { useUi } from '../ui/UiContext'

const DAY = 86_400_000

/** Steps through the stalest prices: type the new price, press Enter, and it jumps to the next. */
export function RepricePage() {
  const { rows, apply, notify } = useStore()
  const { view } = useUi()
  const ctx = useChangeCtx()
  const [onlyStale, setOnlyStale] = useState(false)
  const isMobile = useIsMobile()
  const inputs = useRef(new Map<string, HTMLInputElement>())

  const list = useMemo(
    () =>
      rows
        .filter((r) => (view === 'all' || r.item.profileId === view) && r.item.kind !== 'bulk' && r.qty > 0 && (!onlyStale || r.stalePrice))
        .sort((a, b) => a.item.marketPriceUpdatedAt - b.item.marketPriceUpdatedAt)
        .slice(0, 300),
    [rows, view, onlyStale],
  )


  function commit(i: number, value: string) {
    const r = list[i]
    if (!r || value.trim() === '') return
    const c = parseMoney(value)
    if (c === null || c < 0) return notify('Enter a valid price', true)
    if (c === r.item.marketPriceCents) return
    try { apply(updateItem(ctx(), r.item, { marketPriceCents: c })) } catch (e) { notify((e as Error).message, true) }
  }

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-5 md:p-7">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Reprice</h1>
        <span className="text-sm opacity-70 max-md:hidden">Oldest prices first. Type the new market price and press Enter to save and move to the next. Leave a row blank to skip it.</span>
        <label className="ml-auto flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyStale} onChange={(e) => setOnlyStale(e.target.checked)} /> Only stale prices</label>
      </div>
      {isMobile && <p className="mb-3 text-sm opacity-70">Oldest prices first. Type the new market price and tap Save (or Go) to move to the next. Leave a row blank to skip it.</p>}
      {list.length === 0 ? <p className="opacity-70">{onlyStale ? 'No stale prices.' : 'No stock to reprice.'}</p> : isMobile ? (
        <ul className="space-y-2" aria-label="Prices to update">
          {list.map((r, i) => {
            const age = Math.floor((Date.now() - r.item.marketPriceUpdatedAt) / DAY)
            const next = () => {
              const el = inputs.current.get(r.item.id)
              if (!el) return
              const nextId = list[i + 1]?.item.id
              commit(i, el.value)
              el.value = ''
              setTimeout(() => { if (nextId) inputs.current.get(nextId)?.focus() }, 0)
            }
            return (
              <li key={r.item.id} className="rounded-2xl border border-line bg-surface p-3 shadow-card">
                <p className="font-medium">{r.item.name} <span className="text-xs font-normal opacity-60">{[r.item.setName, r.item.cardNumber, r.item.variant].filter(Boolean).join(' · ')}</span></p>
                <p className="mt-0.5 text-xs">
                  <span className={r.stalePrice ? 'text-accent-ink' : 'opacity-70'}>Updated {fmtDate(r.item.marketPriceUpdatedAt)} ({age}d)</span>
                  <span className="opacity-70"> · Market {formatAud(r.item.marketPriceCents)} · Sticker {formatAud(r.sticker)}</span>
                </p>
                <div className="mt-2 flex gap-2">
                  <input ref={(el) => { if (el) inputs.current.set(r.item.id, el); else inputs.current.delete(r.item.id) }} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-transparent px-3 text-right"
                    aria-label={`New price for ${r.item.name} ${r.item.cardNumber}`} inputMode="decimal" enterKeyHint="next" placeholder={`New price (now ${(r.item.marketPriceCents / 100).toFixed(2)})`}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next() } }} />
                  <button className={`${btnCls} !h-11 !px-5`} onClick={next}>Save</button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase"><tr><th className="py-1">Item</th><th>Last updated</th><th className="text-right">Market now</th><th className="text-right">Sticker now</th><th className="text-right">New market price</th></tr></thead>
          <tbody>
            {list.map((r, i) => {
              const age = Math.floor((Date.now() - r.item.marketPriceUpdatedAt) / DAY)
              return (
                <tr key={r.item.id} className="border-t border-line">
                  <td className="py-1.5">{r.item.name} <span className="opacity-60">{[r.item.setName, r.item.cardNumber, r.item.variant].filter(Boolean).join(' · ')}</span></td>
                  <td className={r.stalePrice ? 'text-accent-ink' : 'opacity-70'}>{fmtDate(r.item.marketPriceUpdatedAt)} ({age}d)</td>
                  <td className="text-right">{formatAud(r.item.marketPriceCents)}</td>
                  <td className="text-right">{formatAud(r.sticker)}</td>
                  <td className="text-right">
                    <input ref={(el) => { if (el) inputs.current.set(r.item.id, el); else inputs.current.delete(r.item.id) }} className="w-28 rounded border border-line bg-transparent px-2 py-1 text-right" aria-label={`New price for ${r.item.name} ${r.item.cardNumber}`}
                      inputMode="decimal" placeholder={(r.item.marketPriceCents / 100).toFixed(2)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const nextId = list[i + 1]?.item.id; commit(i, e.currentTarget.value); e.currentTarget.value = ''; setTimeout(() => { if (nextId) inputs.current.get(nextId)?.focus() }, 0) } }} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </main>
  )
}
