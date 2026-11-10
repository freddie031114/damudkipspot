import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { recordSale, updateShow, voidSale } from '../data/changes'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import { addToCart, cartToDraft, cartTotals, oversoldLines, type CartLine } from '../domain/cart'
import { formatAud, parseMoney } from '../domain/money'
import type { PaymentMethod } from '../domain/sale'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { toggleTheme } from '../lib/theme'
import { btnCls, ghostBtn, inputCls } from '../ui/common'
import { methodLabel, nameOf } from '../ui/format'
import { useShow } from './showSummary'

const METHODS: PaymentMethod[] = ['cash', 'card', 'payid', 'trade']

/** Minimal, fast selling screen for use at the table. */
export function ShowMode() {
  const { id } = useParams()
  const data = useShow(id)
  const { rows, apply, notify, online, pending } = useStore()
  const ctx = useChangeCtx()
  const { acting, setActing } = useActingProfile()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const searchRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    if (!query.trim()) return []
    return rows.filter((r) => r.qty > 0 && matchesSearch(r.item, query)).slice(0, 10)
  }, [rows, query])
  useEffect(() => setCursor(0), [query])
  useEffect(() => searchRef.current?.focus(), [])

  if (!data) return <main className="p-6">That show was not found. <Link to="/shows" className="underline">Back to shows</Link></main>
  const { show, sales, summary } = data

  const discountCents = discount.trim() === '' ? 0 : parseMoney(discount)
  const totals = cartTotals(cart, discountCents ?? 0)
  const warn = oversoldLines(cart)

  function add(r: InventoryRow) {
    setCart((c) => addToCart(c, { itemId: r.item.id, ownerProfileId: r.item.profileId, name: [r.item.name, r.item.cardNumber].filter(Boolean).join(' '), stickerPriceCents: r.sticker, unitPriceCents: r.sticker, available: r.qty }))
    setQuery('')
    searchRef.current?.focus()
  }

  function complete() {
    if (!acting) return notify('Choose who is selling first', true)
    if (cart.length === 0) return notify('Add an item first', true)
    if (discountCents === null) return notify('Discount is not a valid amount', true)
    try {
      apply(recordSale(ctx(), cartToDraft(cart, { soldBy: acting, method, discountCents }), { showId: show.id }))
      setCart([])
      setDiscount('')
      setQuery('')
      searchRef.current?.focus()
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); complete() }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[cursor]; if (r) add(r) }
    else if (e.key === 'Escape') { setQuery('') }
    else if (e.ctrlKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); setMethod(METHODS[Number(e.key) - 1]!) }
  }

  const patchLine = (i: number, p: Partial<CartLine>) => setCart((c) => c.map((l, n) => (n === i ? { ...l, ...p } : l)))
  const closed = show.status === 'closed'

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-2">
        <Link to={`/shows/${show.id}`} className="text-sm underline">‹ Exit</Link>
        <h1 className="text-lg font-semibold">{show.name}</h1>
        <div className="ml-4 text-sm"><span className="opacity-70">Takings</span> <strong className="text-2xl" aria-label="Takings total">{formatAud(summary.totalCents)}</strong>
          <span className="ml-3 opacity-70">{summary.salesCount} sales</span></div>
        <div className="flex gap-3 text-xs opacity-80" aria-label="Takings by payment method">
          {METHODS.filter((m) => summary.byMethod[m] > 0).map((m) => <span key={m}>{methodLabel[m]} {formatAud(summary.byMethod[m])}</span>)}
        </div>
        <span className="ml-auto flex items-center gap-3">
          <span role="status" className={`rounded-full px-3 py-0.5 text-xs ${!online ? 'bg-accent/20 text-accent-ink' : pending ? 'bg-brand/20' : 'bg-emerald-500/20'}`}>{!online ? 'Offline: saved here' : pending ? 'Syncing…' : 'Synced'}</span>
          <label className="text-sm">Selling as{' '}
            <select aria-label="Selling as" className="rounded border border-line bg-transparent px-1 py-0.5 text-base font-semibold" value={acting ?? ''} onChange={(e) => setActing(e.target.value as 'p1' | 'p2')}>
              {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
            </select>
          </label>
          <button className="text-sm underline" onClick={toggleTheme}>Theme</button>
        </span>
      </header>

      {closed && (
        <p className="border-b border-accent bg-accent/15 px-4 py-2 text-sm" role="alert">
          This show is closed. Sales you make now still count towards it.{' '}
          <button className="underline" onClick={() => { try { apply(updateShow(ctx(), show, { status: 'live' })) } catch (e) { notify((e as Error).message, true) } }}>Reopen it</button>
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1fr_26rem]">
        <section className="flex min-h-0 flex-col" aria-label="Find a card">
          <input ref={searchRef} aria-label="Search stock" className="w-full rounded-lg border-2 border-brand bg-transparent px-4 py-3 text-2xl"
            placeholder="Search name, number, set…  then Enter to add" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} />
          <ul className="mt-2 min-h-0 min-w-0 flex-1 overflow-auto" role="listbox" aria-label="Matches">
            {results.map((r, i) => (
              <li key={r.item.id} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => add(r)}
                className={`flex cursor-pointer items-center justify-between rounded px-3 py-2 text-lg ${i === cursor ? 'bg-brand text-brand-fg' : 'hover:bg-hover'}`}>
                <span>{r.item.name} <span className="opacity-70">{[r.item.setName, r.item.cardNumber, r.item.variant, r.item.condition].filter(Boolean).join(' · ')}</span>
                  {r.item.profileId !== acting && <span className="ml-2 rounded bg-chip px-1.5 text-xs text-ink">{nameOf(r.item.profileId)}</span>}</span>
                <span className="font-semibold">{formatAud(r.sticker)} <span className="text-sm font-normal opacity-70">· {r.qty} left</span></span>
              </li>
            ))}
            {query.trim() && results.length === 0 && <li className="px-3 py-2 opacity-70">Nothing in stock matches.</li>}
          </ul>

          <div className="mt-2 border-t border-line pt-2">
            <h2 className="mb-1 text-sm font-semibold">Recent sales</h2>
            <ul className="max-h-40 overflow-y-auto text-sm">
              {sales.slice(0, 6).map((s) => {
                const total = s.lines.reduce((n, l) => n + l.qty * l.unitPriceCents, 0) - s.discountCents
                return (
                  <li key={s.id} className={`flex items-center justify-between border-t border-line py-1 ${s.voidedAt ? 'line-through opacity-50' : ''}`}>
                    <span>{new Date(s.soldAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })} · {s.lines.length} item(s) · {nameOf(s.soldByProfileId)} · {[...new Set(s.payments.map((p) => methodLabel[p.method]))].join('+')}</span>
                    <span>{formatAud(total)} {!s.voidedAt && <button className="ml-2 text-xs underline" onClick={() => apply(voidSale(ctx(), s), { undoable: false })}>Void</button>}</span>
                  </li>
                )
              })}
              {sales.length === 0 && <li className="opacity-60">None yet.</li>}
            </ul>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-lg border border-line bg-surface p-3" aria-label="Current sale">
          <h2 className="mb-2 font-semibold">Current sale</h2>
          <ul className="min-h-0 min-w-0 flex-1 overflow-auto">
            {cart.map((l, i) => (
              <li key={l.itemId + l.unitPriceCents} className="border-t border-line py-2 first:border-0">
                <div className="flex justify-between gap-2"><span className="font-medium">{l.name}</span><button aria-label={`Remove ${l.name}`} onClick={() => setCart((c) => c.filter((_, n) => n !== i))}>×</button></div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <button className={ghostBtn} aria-label={`Fewer ${l.name}`} onClick={() => (l.qty > 1 ? patchLine(i, { qty: l.qty - 1 }) : setCart((c) => c.filter((_, n) => n !== i)))}>−</button>
                  <span className="w-6 text-center">{l.qty}</span>
                  <button className={ghostBtn} aria-label={`More ${l.name}`} onClick={() => patchLine(i, { qty: l.qty + 1 })}>+</button>
                  <span className="opacity-60">×</span>
                  <input className="w-24 rounded border border-line bg-transparent px-1 py-0.5 text-right" aria-label={`Price for ${l.name}`} inputMode="decimal" defaultValue={(l.unitPriceCents / 100).toFixed(2)}
                    key={l.unitPriceCents} onBlur={(e) => { const c = parseMoney(e.target.value); if (c === null || c < 0) { e.target.value = (l.unitPriceCents / 100).toFixed(2); notify('Enter a valid price', true) } else patchLine(i, { unitPriceCents: c }) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); searchRef.current?.focus() } }} />
                  {l.unitPriceCents !== l.stickerPriceCents && <span className="text-xs opacity-60">sticker {formatAud(l.stickerPriceCents)}</span>}
                </div>
              </li>
            ))}
            {cart.length === 0 && <li className="py-6 text-center opacity-60">Search for a card and press Enter to add it.</li>}
          </ul>
          {warn.length > 0 && <p className="mb-2 rounded border border-accent px-2 py-1 text-xs" role="alert">More than the stock on hand: {[...new Set(warn.map((w) => w.name))].join(', ')}. It will be recorded as oversold.</p>}
          <label className="mb-2 flex items-center justify-between text-sm">Bundle discount
            <input className={`${inputCls} w-24 text-right`} aria-label="Discount" inputMode="decimal" placeholder="$0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Payment method">
            {METHODS.map((m, i) => (
              <button key={m} role="radio" aria-checked={method === m} onClick={() => { setMethod(m); searchRef.current?.focus() }}
                className={`flex-1 rounded border px-1 py-1.5 text-sm ${method === m ? 'border-brand bg-brand text-brand-fg' : 'border-line'}`}>{methodLabel[m]}<span className="block text-[10px] opacity-60">Ctrl+{i + 1}</span></button>
            ))}
          </div>
          <div className="mb-2 flex items-baseline justify-between"><span>Total</span><strong className="text-3xl" aria-label="Sale total">{formatAud(totals.totalCents)}</strong></div>
          <button className={`${btnCls} !py-3 !text-lg`} onClick={complete} disabled={cart.length === 0}>Sell (Ctrl+Enter)</button>
        </aside>
      </div>
    </div>
  )
}
