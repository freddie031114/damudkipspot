import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { recordSale } from '../data/changes'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { dealNumbers, dealToDraft, type DealIn, type DealOut } from '../domain/deal'
import { formatAud, parseMoney } from '../domain/money'
import type { PaymentMethod } from '../domain/sale'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { useIsMobile } from '../lib/useMedia'
import { btnCls } from './common'
import { methodLabel } from './format'

interface OutLine extends DealOut { name: string; sub: string; available: number }
interface InLine extends DealIn { key: string }
type CashDir = 'in' | 'none' | 'out'

const card = 'rounded-2xl border border-line bg-surface p-3 shadow-card'
const field = 'h-11 w-full rounded-xl border border-line bg-transparent px-3 outline-none transition-colors placeholder:opacity-50 focus:border-brand focus-visible:outline-none'
const stepBtn = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-lg leading-none hover:bg-hover active:scale-95'
const blankIn = { name: '', cardNumber: '', qty: '1', worth: '' }

const toOut = (r: InventoryRow): OutLine => ({
  itemId: r.item.id, ownerProfileId: r.item.profileId, qty: 1, stickerPriceCents: r.sticker, available: r.qty,
  name: r.item.name, sub: [r.item.cardNumber, r.item.condition, r.item.variant].filter(Boolean).join(' · '),
})

function Heading({ tone, title, hint }: { tone: 'out' | 'in' | 'cash'; title: string; hint: string }) {
  const dot = tone === 'out' ? 'bg-accent' : tone === 'in' ? 'bg-brand' : 'bg-emerald-500'
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${dot}`} aria-hidden="true" />
      <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
      <span className="truncate text-xs opacity-60">{hint}</span>
    </div>
  )
}

/**
 * Logs a deal the way it happens at the table: what went out, what came in, and the cash either
 * way. No per-card prices. Used by Show mode and by the Sell button everywhere else.
 */
export function DealForm({ showId = null, initial, wide, side, stickySubmit, onLogged }: {
  showId?: string | null
  /** A card to start the deal with (the Sell button on an inventory row). */
  initial?: InventoryRow
  /** Two columns on a wide screen: cards on the left, cash and the button on the right. */
  wide?: boolean
  /** Extra content under the button (the list of recent deals in Show mode). */
  side?: ReactNode
  stickySubmit?: boolean
  onLogged?: () => void
}) {
  const { rows, apply, notify } = useStore()
  const { acting } = useActingProfile()
  const ctx = useChangeCtx()
  const isMobile = useIsMobile()
  const [out, setOut] = useState<OutLine[]>(() => (initial ? [toOut(initial)] : []))
  const [incoming, setIncoming] = useState<InLine[]>([])
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [inF, setInF] = useState(blankIn)
  const [picked, setPicked] = useState<InventoryRow | null>(null)
  const [inOwnerPick, setInOwnerPick] = useState<ProfileId | null>(null)
  /** null means "work it out for me": a sale takes the sticker total, a swap is even, a buy needs an amount. */
  const [cash, setCash] = useState<{ dir: CashDir; amount: string } | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [error, setError] = useState('')
  // In the pop-up on a phone a plain sale should fit on one screen, so "coming in" starts folded away.
  const [inOpen, setInOpen] = useState(() => wide || !window.matchMedia('(max-width: 767px)').matches)
  const searchRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!isMobile) (initial ? amountRef : searchRef).current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setCursor(0), [query])

  const results = useMemo(
    () => (query.trim() ? rows.filter((r) => r.item.kind !== 'bulk' && r.qty > 0 && matchesSearch(r.item, query)).slice(0, 8) : []),
    [rows, query],
  )
  const suggestions = useMemo(
    () => (!picked && inF.name.trim().length >= 2 ? rows.filter((r) => r.item.kind !== 'bulk' && matchesSearch(r.item, `${inF.name} ${inF.cardNumber}`)).slice(0, 3) : []),
    [rows, inF.name, inF.cardNumber, picked],
  )

  const inOwner: ProfileId = inOwnerPick ?? out[0]?.ownerProfileId ?? acting ?? 'p1'
  const stickerTotal = out.reduce((n, o) => n + o.qty * o.stickerPriceCents, 0)

  /** The card typed into the "coming in" boxes, whether or not Add was pressed (so it is never lost). */
  function pendingIn(): InLine | null {
    const name = inF.name.trim()
    if (!name) return null
    const qty = Number(inF.qty)
    if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of at least 1')
    const worth = inF.worth.trim() === '' ? null : parseMoney(inF.worth)
    if (inF.worth.trim() !== '' && (worth === null || worth < 0)) throw new Error('“Worth” is not a valid amount')
    return { key: crypto.randomUUID(), itemId: picked?.item.id ?? null, ownerProfileId: picked ? picked.item.profileId : inOwner, name, cardNumber: inF.cardNumber.trim(), qty, worthCents: worth }
  }

  const hasIncoming = incoming.length > 0 || inF.name.trim() !== ''
  const auto: { dir: CashDir; amount: string } = !hasIncoming
    ? { dir: 'in', amount: out.length ? (stickerTotal / 100).toFixed(2) : '' }
    : out.length === 0 ? { dir: 'out', amount: '' } : { dir: 'none', amount: '' }
  const cur = cash ?? auto
  const payMethod: PaymentMethod = cur.dir === 'out' && method === 'card' ? 'cash' : method

  function cashCents(): number | null {
    if (cur.dir === 'none') return 0
    if (cur.amount.trim() === '') return null
    const c = parseMoney(cur.amount)
    return c === null || c < 0 ? null : cur.dir === 'in' ? c : -c
  }

  // A live read of the deal so far: either the numbers, or what is still missing.
  const preview = (() => {
    try {
      const extra = pendingIn()
      const all = extra ? [...incoming, extra] : incoming
      if (out.length === 0 && all.length === 0) return { hint: 'Add what went out, what came in, or both.' }
      const c = cashCents()
      if (c === null) return { hint: cur.dir === 'out' ? 'Enter how much you paid.' : 'Enter how much they paid, or choose “No cash”.' }
      return { numbers: dealNumbers({ out, incoming: all, cashCents: c }), cash: c, all }
    } catch (e) {
      return { hint: (e as Error).message }
    }
  })()

  function addOut(r: InventoryRow) {
    setOut((cur) => (cur.some((l) => l.itemId === r.item.id) ? cur.map((l) => (l.itemId === r.item.id ? { ...l, qty: l.qty + 1 } : l)) : [...cur, toOut(r)]))
    setQuery('')
    setError('')
    if (!isMobile) searchRef.current?.focus()
  }
  const setQty = (itemId: string, qty: number) => setOut((cur) => (qty < 1 ? cur.filter((l) => l.itemId !== itemId) : cur.map((l) => (l.itemId === itemId ? { ...l, qty } : l))))

  function addIn() {
    try {
      const line = pendingIn()
      if (!line) return setError('Name the card that came in')
      setIncoming((cur) => [...cur, line])
      setInF(blankIn)
      setPicked(null)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function pickExisting(r: InventoryRow) {
    setPicked(r)
    setInF({ ...inF, name: r.item.name, cardNumber: r.item.cardNumber, worth: inF.worth || (r.item.marketPriceCents ? (r.item.marketPriceCents / 100).toFixed(2) : '') })
  }

  function log() {
    if (!acting) return notify('Choose who is using the app first', true)
    try {
      const extra = pendingIn()
      const all = extra ? [...incoming, extra] : incoming
      const c = cashCents()
      if (c === null) {
        amountRef.current?.focus()
        throw new Error(cur.dir === 'out' ? 'Enter how much you paid' : 'Enter how much they paid, or choose “No cash”')
      }
      apply(recordSale(ctx(), dealToDraft({ by: acting, out, incoming: all, cashCents: c, method: payMethod }), { showId }))
      setOut([]); setIncoming([]); setInF(blankIn); setPicked(null); setCash(null); setInOwnerPick(null); setQuery(''); setError('')
      if (!isMobile) searchRef.current?.focus()
      onLogged?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); log() }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[cursor]; if (r) addOut(r) }
    else if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') }
  }
  const onInKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) log(); else addIn()
  }

  const oversold = out.filter((l) => l.qty > l.available)
  const n = preview.numbers
  const kind = !n ? null : out.length === 0 ? 'buy' : preview.all!.length > 0 ? 'trade' : 'sale'
  const outUnits = out.reduce((s, l) => s + l.qty, 0)
  const inUnits = (preview.all ?? incoming).reduce((s, l) => s + l.qty, 0)
  const plural = (u: number) => `${u} card${u === 1 ? '' : 's'}`

  const outSection = (
    <section className={card} aria-label="Going out">
      <Heading tone="out" title="Going out" hint="Cards leaving your stock" />
      <input ref={searchRef} type="search" aria-label="Search stock" className={field} placeholder="Search your stock to add a card…" value={query}
        onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} />
      {query.trim() !== '' && (
        <ul className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Matches">
          {results.map((r, i) => (
            <li key={r.item.id} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => addOut(r)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-1.5 ${i === cursor ? 'bg-brand text-brand-fg' : ''}`}>
              <span className="min-w-0 truncate">{r.item.name} <span className="text-sm opacity-70">{[r.item.cardNumber, r.item.condition].filter(Boolean).join(' · ')}</span>
                {r.item.profileId !== acting && <span className="ml-2 rounded bg-chip px-1.5 text-xs text-ink">{DEFAULT_NAMES[r.item.profileId]}</span>}</span>
              <span className="shrink-0 text-sm">{formatAud(r.sticker)} <span className="opacity-70">· {r.qty} left</span></span>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-sm opacity-70">Nothing in stock matches.</li>}
        </ul>
      )}
      <ul className="mt-1">
        {out.map((l) => (
          <li key={l.itemId} className="flex items-center gap-2 border-t border-line py-2 first:border-0">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{l.name}</p>
              <p className="truncate text-xs opacity-60">{[l.sub, `sticker ${formatAud(l.stickerPriceCents)}`].filter(Boolean).join(' · ')}{l.ownerProfileId !== acting && ` · ${DEFAULT_NAMES[l.ownerProfileId]}'s`}</p>
            </div>
            <button type="button" className={stepBtn} aria-label={`Fewer ${l.name}`} onClick={() => setQty(l.itemId, l.qty - 1)}>−</button>
            <span className="w-6 text-center font-semibold" aria-label={`Quantity of ${l.name}`}>{l.qty}</span>
            <button type="button" className={stepBtn} aria-label={`More ${l.name}`} onClick={() => setQty(l.itemId, l.qty + 1)}>+</button>
            <button type="button" className="flex h-9 w-8 shrink-0 items-center justify-center text-xl opacity-60 hover:opacity-100" aria-label={`Remove ${l.name}`} onClick={() => setQty(l.itemId, 0)}>×</button>
          </li>
        ))}
      </ul>
      {out.length === 0 && query.trim() === '' && <p className="px-1 pt-1 text-sm opacity-60">Nothing going out. Leave this empty if you are only buying.</p>}
      {oversold.length > 0 && <p className="mt-1 rounded-lg border border-accent px-2 py-1 text-xs" role="alert">More than you have in stock: {oversold.map((l) => l.name).join(', ')}. It will show as oversold.</p>}
    </section>
  )

  const inSection = !inOpen && incoming.length === 0 && !inF.name ? (
    <button type="button" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand/60 px-3 text-sm font-medium text-brand" onClick={() => setInOpen(true)}>
      + Cards coming in <span className="font-normal opacity-70">(trade or buy)</span>
    </button>
  ) : (
    <section className={card} aria-label="Coming in">
      <Heading tone="in" title="Coming in" hint="Cards you received" />
      {incoming.length > 0 && (
        <ul className="mb-2">
          {incoming.map((l) => (
            <li key={l.key} className="flex items-center gap-2 border-t border-line py-2 first:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.qty} × {l.name} <span className="text-sm font-normal opacity-60">{l.cardNumber}</span></p>
                <p className="truncate text-xs opacity-60">
                  {l.itemId ? 'Adds to stock you already have' : 'New card'} · {DEFAULT_NAMES[l.ownerProfileId]}'s stock{l.worthCents !== null && ` · worth ${formatAud(l.worthCents)} each`}
                </p>
              </div>
              <button type="button" className="flex h-9 w-8 shrink-0 items-center justify-center text-xl opacity-60 hover:opacity-100" aria-label={`Remove ${l.name} from coming in`} onClick={() => setIncoming((cur) => cur.filter((x) => x.key !== l.key))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-12 gap-2" onKeyDown={onInKey}>
        <input className={`${field} col-span-12 md:col-span-5`} aria-label="Card coming in" placeholder="Card name" value={inF.name}
          onChange={(e) => { setInF({ ...inF, name: e.target.value }); setPicked(null) }} />
        <input className={`${field} col-span-3 !px-2 md:col-span-2 md:!px-3`} aria-label="Card number" placeholder="No." value={inF.cardNumber} readOnly={!!picked} onChange={(e) => setInF({ ...inF, cardNumber: e.target.value })} />
        <input className={`${field} col-span-2 md:col-span-1 !px-1 text-center`} aria-label="Quantity coming in" inputMode="numeric" value={inF.qty} onChange={(e) => setInF({ ...inF, qty: e.target.value })} />
        <input className={`${field} col-span-4 !px-2 md:col-span-2 md:!px-3`} aria-label="Worth each (optional)" inputMode="decimal" placeholder="Worth $" title="What each card is worth. Optional: it sets the market price of a new card." value={inF.worth} onChange={(e) => setInF({ ...inF, worth: e.target.value })} />
        <button type="button" className="col-span-3 flex h-11 items-center justify-center rounded-xl border border-brand font-medium text-brand hover:bg-brand/10 md:col-span-2" onClick={addIn}>Add</button>
        {suggestions.length > 0 && (
          <ul className="col-span-12 rounded-xl border border-accent" role="listbox" aria-label="Already in stock">
            <li className="px-3 pt-1.5 text-[11px] uppercase tracking-wider opacity-60">Already in stock? Tap to add to it</li>
            {suggestions.map((r) => (
              <li key={r.item.id} role="option" aria-selected={false} className="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 hover:bg-hover" onClick={() => pickExisting(r)}>
                <span className="min-w-0 truncate">{r.item.name} <span className="text-sm opacity-60">{r.item.cardNumber} {r.item.condition}</span></span>
                <span className="shrink-0 text-xs opacity-70">{DEFAULT_NAMES[r.item.profileId]} · {r.qty} in stock</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="opacity-60 max-md:hidden">“Worth” is optional. Prices can be set later in Reprice.</span>
        <label className="flex items-center gap-1.5">New cards go to
          <select aria-label="Incoming stock goes to" className="rounded-lg border border-line bg-transparent px-1.5 py-1" value={inOwner} onChange={(e) => setInOwnerPick(e.target.value as ProfileId)}>
            {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
          </select>
        </label>
      </div>
    </section>
  )

  const DIRS: { id: CashDir; label: string }[] = [{ id: 'in', label: 'They paid' }, { id: 'none', label: 'No cash' }, { id: 'out', label: 'We paid' }]
  const cashSection = (
    <section className={card} aria-label="Cash">
      <Heading tone="cash" title="Cash" hint="Money that changed hands" />
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-hover p-1" role="radiogroup" aria-label="Cash direction">
        {DIRS.map((d) => (
          <button type="button" key={d.id} role="radio" aria-checked={cur.dir === d.id} onClick={() => { setCash({ dir: d.id, amount: cash ? cash.amount : d.id === auto.dir ? auto.amount : '' }); setError(''); if (d.id !== 'none' && !isMobile) setTimeout(() => amountRef.current?.select(), 0) }}
            className={`h-10 rounded-lg text-sm transition-colors ${cur.dir === d.id ? (d.id === 'out' ? 'bg-accent font-semibold text-[#2b1600] shadow-sm' : d.id === 'in' ? 'bg-emerald-600 font-semibold text-white shadow-sm' : 'bg-surface font-semibold shadow-sm') : 'opacity-70'}`}>{d.label}</button>
        ))}
      </div>
      {cur.dir !== 'none' && (
        <>
          <label className="mt-2 flex items-center gap-2 rounded-xl border border-line px-3 focus-within:border-brand">
            <span className="text-2xl font-semibold opacity-50">$</span>
            <input ref={amountRef} className="h-14 w-full min-w-0 bg-transparent text-3xl font-semibold outline-none placeholder:opacity-30 focus-visible:outline-none" inputMode="decimal" placeholder="0.00"
              aria-label={cur.dir === 'in' ? 'Cash they paid' : 'Cash we paid'} value={cur.amount}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => { setCash({ dir: cur.dir, amount: e.target.value }); setError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); log() } }} />
          </label>
          <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="How it was paid">
            {(cur.dir === 'in' ? (['cash', 'card', 'payid'] as const) : (['cash', 'payid'] as const)).map((m) => (
              <button type="button" key={m} role="radio" aria-checked={payMethod === m} onClick={() => setMethod(m)}
                className={`h-9 flex-1 rounded-lg border text-sm ${payMethod === m ? 'border-brand bg-brand text-brand-fg' : 'border-line'}`}>{methodLabel[m]}</button>
            ))}
          </div>
        </>
      )}
      {cash === null && cur.dir === 'in' && out.length > 0 && <p className="mt-2 text-xs opacity-60">Filled in from the stickers. Change it to what they actually paid.</p>}
    </section>
  )

  const submit = (
    <div className={stickySubmit ? 'max-md:sticky max-md:bottom-0 max-md:-mx-3 max-md:border-t max-md:border-line max-md:bg-page max-md:px-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:pt-2' : ''}>
      <div className="mb-2 min-h-5 text-sm" aria-label="Deal summary" role="status">
        {error ? <span role="alert" className="text-red-500">{error}</span> : !n ? <span className="opacity-60">{preview.hint}</span> : kind === 'sale' ? (
          <span>{plural(outUnits)} out for <strong>{formatAud(preview.cash!)}</strong>{n.stickerCents > 0 && preview.cash !== n.stickerCents && <span className="opacity-60"> · {formatAud(Math.abs(n.stickerCents - preview.cash!))} {preview.cash! < n.stickerCents ? 'under' : 'over'} sticker</span>}</span>
        ) : kind === 'buy' ? (
          <span>{plural(inUnits)} in for <strong>{formatAud(-preview.cash!)}</strong></span>
        ) : (
          <span>{plural(outUnits)} out, {plural(inUnits)} in{preview.cash !== 0 && <>, {preview.cash! > 0 ? 'they paid' : 'we paid'} <strong>{formatAud(Math.abs(preview.cash!))}</strong></>}<span className="opacity-60"> · their cards come in at {formatAud(n.tradeValueCents)}</span></span>
        )}
      </div>
      <button type="button" className={`${btnCls} !w-full !py-3 !text-base`} onClick={log} disabled={out.length === 0 && !hasIncoming}>
        {kind === 'sale' ? 'Log sale' : kind === 'buy' ? 'Log buy' : kind === 'trade' ? 'Log trade' : 'Log deal'}<span className="max-md:hidden opacity-70"> (Ctrl+Enter)</span>
      </button>
    </div>
  )

  if (wide && !isMobile) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !(e.target as HTMLElement).closest('input')) { e.preventDefault(); log() } }}>
        <div className="space-y-4">{outSection}{inSection}</div>
        <div className="space-y-4">{cashSection}{submit}{side}</div>
      </div>
    )
  }
  return <div className="space-y-3">{outSection}{inSection}{cashSection}{submit}{side}</div>
}
