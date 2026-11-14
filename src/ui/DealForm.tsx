import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { recordSale } from '../data/changes'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { quickDealToDraft, quickNumbers, solveQuick, typedFields, type DealOut, type QuickField, type QuickTotals } from '../domain/deal'
import { formatAud, parseMoney } from '../domain/money'
import type { PaymentMethod } from '../domain/sale'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { useIsMobile } from '../lib/useMedia'
import { btnCls } from './common'
import { methodLabel } from './format'

type Mode = 'sale' | 'trade' | 'buy'
type Dir = 'in' | 'out'
interface Pick extends DealOut { name: string; sub: string; available: number }

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'sale', label: 'Sale', hint: 'Cards out, cash in' },
  { id: 'trade', label: 'Trade', hint: 'Cards both ways' },
  { id: 'buy', label: 'Buy', hint: 'Cards in, cash out' },
]

const card = 'rounded-2xl border border-line bg-surface p-3 shadow-card'
const small = 'h-10 w-full rounded-xl border border-line bg-transparent px-3 text-sm !outline-none transition-colors placeholder:opacity-50 focus:border-brand'
const stepBtn = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-lg leading-none hover:bg-hover active:scale-95'

const toPick = (r: InventoryRow): Pick => ({
  itemId: r.item.id, ownerProfileId: r.item.profileId, qty: 1, stickerPriceCents: r.sticker, available: r.qty,
  name: r.item.name, sub: [r.item.cardNumber, r.item.condition, r.item.variant].filter(Boolean).join(' · '),
})

/** A big number box. The one that is worked out for you is shown faded with an "auto" tag until you type in it. */
function Amount({ label, hint, value, auto, onType, onEnter, aria, tone, inputRef }: {
  label: string; hint: string; value: string; auto: boolean; onType: (v: string) => void; onEnter: () => void; aria: string
  tone: 'out' | 'in' | 'cash'; inputRef?: React.Ref<HTMLInputElement>
}) {
  const bar = tone === 'out' ? 'border-l-accent' : tone === 'in' ? 'border-l-brand' : 'border-l-emerald-500'
  return (
    <label className={`block rounded-2xl border border-line border-l-4 ${bar} bg-surface px-3 pb-1.5 pt-2 shadow-card focus-within:border-brand`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        {auto ? <span className="rounded bg-chip px-1.5 text-[10px] font-semibold uppercase text-ink">auto</span> : <span className="truncate text-[11px] opacity-50 md:hidden">{hint}</span>}
      </span>
      <span className="flex items-center gap-1">
        <span className="text-2xl font-semibold opacity-40">$</span>
        <input ref={inputRef} aria-label={aria} inputMode="decimal" placeholder="0.00" value={value}
          className={`h-12 w-full min-w-0 bg-transparent text-3xl font-semibold !outline-none placeholder:opacity-25 ${auto ? 'opacity-50' : ''}`}
          onFocus={(e) => e.currentTarget.select()} onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }} />
      </span>
    </label>
  )
}

/**
 * Logs a deal with totals, not cards. Sale, trade or buy; type the value of what went out, what
 * came in and the cash, and the rest is worked out. Exact cards can be picked from stock when
 * there is time, but never have to be.
 */
export function DealForm({ showId = null, initial, defaultMode, wide, side, stickySubmit, onLogged }: {
  showId?: string | null
  initial?: InventoryRow
  defaultMode?: Mode
  wide?: boolean
  side?: ReactNode
  stickySubmit?: boolean
  onLogged?: () => void
}) {
  const { rows, apply } = useStore()
  const { acting } = useActingProfile()
  const ctx = useChangeCtx()
  const isMobile = useIsMobile()
  const [mode, setMode] = useState<Mode>(defaultMode ?? (initial ? 'sale' : 'trade'))
  const [outS, setOutS] = useState('')
  const [inS, setInS] = useState('')
  const [cashS, setCashS] = useState('')
  const [dir, setDir] = useState<Dir>('in')
  /** Which boxes were typed in, oldest first: the box typed longest ago is the one that gets worked out. */
  const [order, setOrder] = useState<QuickField[]>([])
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [label, setLabel] = useState('')
  const [count, setCount] = useState('1')
  const [stockPick, setStockPick] = useState<ProfileId | null>(null)
  const [picks, setPicks] = useState<Pick[]>(() => (initial ? [toPick(initial)] : []))
  const [pickOpen, setPickOpen] = useState(!!initial)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState('')
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!isMobile) firstRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setCursor(0), [query])

  const results = useMemo(
    () => (query.trim() ? rows.filter((r) => r.item.kind !== 'bulk' && r.qty > 0 && matchesSearch(r.item, query)).slice(0, 8) : []),
    [rows, query],
  )
  const stockOf: ProfileId = stockPick ?? picks[0]?.ownerProfileId ?? acting ?? 'p1'
  const pickSum = picks.reduce((n, p) => n + p.qty * p.stickerPriceCents, 0)

  const amount = (s: string): number | null => {
    if (s.trim() === '') return null
    const c = parseMoney(s)
    return c === null || c < 0 ? null : c
  }
  const type = (field: QuickField, set: (v: string) => void) => (v: string) => {
    set(v)
    setError('')
    setOrder((o) => (v.trim() === '' ? o.filter((f) => f !== field) : [...o.filter((f) => f !== field), field]))
  }

  // ---- work out the three totals for the chosen mode ----
  const outTyped = amount(outS)
  const inTyped = amount(inS)
  const cashTyped = amount(cashS)
  const outEntered = outTyped ?? (picks.length ? pickSum : null)
  let totals: QuickTotals
  let calculated: QuickField | null = null
  /** The boxes whose numbers were typed (or come from picked cards), as opposed to worked out. */
  let active: QuickField[]
  if (mode === 'trade') {
    const ord: QuickField[] = picks.length && outTyped === null ? ['out', ...order] : order
    const entered = { out: outEntered, in: inTyped, cash: cashTyped === null ? null : dir === 'in' ? cashTyped : -cashTyped }
    const r = solveQuick(entered, ord)
    totals = { outCents: r.outCents, inCents: r.inCents, cashCents: r.cashCents }
    calculated = r.calculated
    active = typedFields(entered, ord)
  } else if (mode === 'sale') {
    const cash = cashTyped ?? outEntered ?? 0
    totals = { outCents: outEntered ?? cash, inCents: 0, cashCents: cash }
    calculated = cashTyped === null && outEntered !== null ? 'cash' : null
    active = [...(outEntered !== null ? ['out' as const] : []), ...(cashTyped !== null ? ['cash' as const] : [])]
  } else {
    const paid = cashTyped ?? inTyped ?? 0
    totals = { outCents: 0, inCents: inTyped ?? paid, cashCents: -paid }
    calculated = cashTyped === null && inTyped !== null ? 'cash' : null
    active = [...(inTyped !== null ? ['in' as const] : []), ...(cashTyped !== null ? ['cash' as const] : [])]
  }
  const shownDir: Dir = mode === 'sale' ? 'in' : mode === 'buy' ? 'out' : cashTyped !== null ? dir : totals.cashCents < 0 ? 'out' : 'in'
  const strings = { out: outS, in: inS, cash: cashS }
  const computed = { out: totals.outCents, in: totals.inCents, cash: Math.abs(totals.cashCents) }
  /** A typed box shows what was typed; a worked-out box shows its number faded with an "auto" tag. */
  const field = (f: QuickField): { value: string; auto: boolean } => {
    if (strings[f].trim() !== '' && active.includes(f)) return { value: strings[f], auto: false }
    if (f === calculated || (f === 'out' && picks.length > 0)) return { value: (computed[f] / 100).toFixed(2), auto: true }
    return { value: '', auto: false }
  }
  const fOut = field('out'), fIn = field('in'), fCash = field('cash')

  const numbers = (() => {
    try { return { n: quickNumbers(totals, picks.length > 0), hint: '' } } catch (e) { return { n: null, hint: (e as Error).message } }
  })()
  const nothing = totals.outCents === 0 && totals.inCents === 0 && totals.cashCents === 0 && picks.length === 0
  const needsStock = !picks.length && (totals.outCents > 0 || totals.inCents > 0)

  function addPick(r: InventoryRow) {
    setPicks((cur) => (cur.some((p) => p.itemId === r.item.id) ? cur.map((p) => (p.itemId === r.item.id ? { ...p, qty: p.qty + 1 } : p)) : [...cur, toPick(r)]))
    setQuery('')
    setError('')
  }
  const setQty = (itemId: string, qty: number) => setPicks((cur) => (qty < 1 ? cur.filter((p) => p.itemId !== itemId) : cur.map((p) => (p.itemId === itemId ? { ...p, qty } : p))))

  function log() {
    if (!acting) return setError('Choose who is using the app first')
    try {
      const qty = Number(count)
      const draft = quickDealToDraft({ by: acting, picks, totals, method: shownDir === 'out' && method === 'card' ? 'cash' : method, stockOf, lot: { label, count: Number.isInteger(qty) && qty >= 1 ? qty : 1 } })
      apply(recordSale(ctx(), draft, { showId }))
      setOutS(''); setInS(''); setCashS(''); setOrder([]); setPicks([]); setLabel(''); setCount('1'); setQuery(''); setError(''); setStockPick(null)
      if (!isMobile) firstRef.current?.focus()
      onLogged?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[cursor]; if (r) addPick(r) }
    else if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') }
  }

  const plural = (u: number) => `${u} card${u === 1 ? '' : 's'}`
  const pickUnits = picks.reduce((n, p) => n + p.qty, 0)
  const outWord = picks.length ? plural(pickUnits) : totals.outCents > 0 ? `cards worth ${formatAud(totals.outCents)}` : ''
  const cashAbs = Math.abs(totals.cashCents)
  const summary = error ? null : !numbers.n ? numbers.hint || null : mode === 'sale'
    ? <>{outWord || 'Cards'} out for <strong>{formatAud(totals.cashCents)}</strong>{totals.outCents > 0 && totals.outCents !== totals.cashCents && <span className="opacity-60"> · {formatAud(Math.abs(totals.outCents - totals.cashCents))} {totals.cashCents < totals.outCents ? 'under' : 'over'} their value</span>}</>
    : mode === 'buy'
      ? <>Cards in for <strong>{formatAud(cashAbs)}</strong>{totals.inCents > cashAbs && <span className="opacity-60"> · worth {formatAud(totals.inCents)}</span>}</>
      : <>{outWord || 'Nothing'} out, cards worth <strong>{formatAud(totals.inCents)}</strong> in{totals.cashCents !== 0 && <>, {totals.cashCents > 0 ? 'they paid' : 'we paid'} <strong>{formatAud(cashAbs)}</strong></>}</>

  const cols = mode === 'trade' ? 'md:grid-cols-3' : 'md:grid-cols-2'
  const body = (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-hover p-1" role="tablist" aria-label="Type of deal">
        {MODES.map((m) => (
          <button type="button" key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => { setMode(m.id); setError(''); if (m.id === 'buy') setPicks([]) }}
            className={`flex h-11 flex-col items-center justify-center rounded-lg leading-tight transition-colors ${mode === m.id ? 'bg-surface font-semibold shadow-sm' : 'opacity-70'}`}>
            <span className="text-sm">{m.label}</span><span className="hidden text-[10px] font-normal opacity-60 md:block">{m.hint}</span>
          </button>
        ))}
      </div>

      <div className={`grid grid-cols-1 gap-2 ${cols}`}>
        {mode !== 'buy' && <Amount tone="out" label="Cards out" hint="value of what you gave" value={fOut.value} auto={fOut.auto} aria="Value of cards out"
          inputRef={firstRef} onEnter={log} onType={type('out', setOutS)} />}
        {mode !== 'sale' && <Amount tone="in" label="Cards in" hint="value of what you got" value={fIn.value} auto={fIn.auto} aria="Value of cards in"
          inputRef={mode === 'buy' ? firstRef : undefined} onEnter={log} onType={type('in', setInS)} />}
        <div className="space-y-1.5">
          <Amount tone="cash" label={mode === 'sale' ? 'They paid' : mode === 'buy' ? 'We paid' : shownDir === 'in' ? 'They paid' : 'We paid'} hint="cash" value={fCash.value} auto={fCash.auto}
            aria={shownDir === 'in' ? 'Cash they paid' : 'Cash we paid'} onEnter={log} onType={type('cash', setCashS)} />
          {mode === 'trade' && (
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-hover p-1" role="radiogroup" aria-label="Cash direction">
              {([['in', 'They paid'], ['none', 'No cash'], ['out', 'We paid']] as const).map(([d, l]) => {
                const active = d === 'none' ? totals.cashCents === 0 : totals.cashCents !== 0 && shownDir === d
                return (
                  <button type="button" key={d} role="radio" aria-checked={active} className={`h-8 whitespace-nowrap rounded-lg px-1 text-[11px] transition-colors ${active ? 'bg-surface font-semibold shadow-sm' : 'opacity-70'}`}
                    onClick={() => {
                      setError('')
                      if (d === 'none') { setCashS('0'); setOrder((o) => [...o.filter((f) => f !== 'cash'), 'cash']); return }
                      setDir(d)
                      if (cashTyped === null) { const v = Math.abs(totals.cashCents); if (v > 0) { setCashS((v / 100).toFixed(2)); setOrder((o) => [...o.filter((f) => f !== 'cash'), 'cash']) } }
                    }}>{l}</button>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {mode === 'trade' && <p className="-mt-1 px-1 text-xs opacity-60">Cards out = cards in + cash. Type any two and the third fills in.</p>}

      {totals.cashCents !== 0 && (
        <div className="flex gap-1.5" role="radiogroup" aria-label="How it was paid">
          {(shownDir === 'in' ? (['cash', 'card', 'payid'] as const) : (['cash', 'payid'] as const)).map((m) => (
            <button type="button" key={m} role="radio" aria-checked={(shownDir === 'out' && method === 'card' ? 'cash' : method) === m} onClick={() => setMethod(m)}
              className={`h-9 flex-1 rounded-lg border text-sm ${(shownDir === 'out' && method === 'card' ? 'cash' : method) === m ? 'border-brand bg-brand text-brand-fg' : 'border-line'}`}>{methodLabel[m]}</button>
          ))}
        </div>
      )}

      {mode !== 'sale' && totals.inCents + (mode === 'buy' ? cashAbs : 0) > 0 && (
        <div className="grid grid-cols-12 gap-2">
          <input className={`${small} col-span-8`} aria-label="What came in (optional)" placeholder="What came in? (optional, e.g. Dan's binder)" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); log() } }} />
          <input className={`${small} col-span-4 text-center`} aria-label="Number of cards that came in" inputMode="numeric" placeholder="How many" title="How many cards (optional)" value={count === '1' ? '' : count} onChange={(e) => setCount(e.target.value.trim() === '' ? '1' : e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); log() } }} />
        </div>
      )}

      {needsStock && (
        <label className="flex items-center justify-between gap-2 px-1 text-xs">
          <span className="opacity-70">{mode === 'buy' ? 'Goes into' : 'Taken from, and new cards go to'}</span>
          <select aria-label="Stock of" className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm" value={stockOf} onChange={(e) => setStockPick(e.target.value as ProfileId)}>
            {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}'s stock</option>)}
          </select>
        </label>
      )}

      {mode !== 'buy' && (
        <div>
          <button type="button" className="flex min-h-9 items-center gap-1.5 px-1 text-sm text-brand underline-offset-2 hover:underline" aria-expanded={pickOpen} onClick={() => setPickOpen(!pickOpen)}>
            {pickOpen ? '▾' : '▸'} Pick exact cards from stock{picks.length > 0 && ` (${pickUnits})`} <span className="text-xs opacity-60">optional</span>
          </button>
          {pickOpen && (
            <section className={`${card} mt-1`} aria-label="Cards picked from stock">
              <input type="search" aria-label="Search stock" className={small} placeholder="Search your stock…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} />
              {query.trim() !== '' && (
                <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Matches">
                  {results.map((r, i) => (
                    <li key={r.item.id} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => addPick(r)}
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
                {picks.map((p) => (
                  <li key={p.itemId} className="flex items-center gap-2 border-t border-line py-2 first:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs opacity-60">{[p.sub, `sticker ${formatAud(p.stickerPriceCents)}`].filter(Boolean).join(' · ')}</p>
                    </div>
                    <button type="button" className={stepBtn} aria-label={`Fewer ${p.name}`} onClick={() => setQty(p.itemId, p.qty - 1)}>−</button>
                    <span className="w-6 text-center font-semibold">{p.qty}</span>
                    <button type="button" className={stepBtn} aria-label={`More ${p.name}`} onClick={() => setQty(p.itemId, p.qty + 1)}>+</button>
                    <button type="button" className="flex h-9 w-8 shrink-0 items-center justify-center text-xl opacity-60 hover:opacity-100" aria-label={`Remove ${p.name}`} onClick={() => setQty(p.itemId, 0)}>×</button>
                  </li>
                ))}
              </ul>
              {picks.length === 0 && query.trim() === '' && <p className="px-1 pt-1 text-xs opacity-60">Picked cards leave your stock and set the “cards out” value from their stickers. Skip this to log by value only.</p>}
              {picks.some((p) => p.qty > p.available) && <p className="mt-1 rounded-lg border border-accent px-2 py-1 text-xs" role="alert">More than you have in stock. It will show as oversold.</p>}
            </section>
          )}
        </div>
      )}
    </div>
  )

  const submit = (
    <div className={stickySubmit ? 'max-md:sticky max-md:bottom-0 max-md:-mx-3 max-md:border-t max-md:border-line max-md:bg-page max-md:px-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:pt-2' : ''}>
      <div className="mb-2 min-h-5 text-sm" aria-label="Deal summary" role="status">
        {error ? <span role="alert" className="text-red-500">{error}</span> : summary ?? <span className="opacity-60">Type the value of the cards and the cash.</span>}
      </div>
      <button type="button" className={`${btnCls} !w-full !py-3 !text-base`} onClick={log} disabled={nothing}>
        Log {mode}<span className="opacity-70 max-md:hidden"> (Enter)</span>
      </button>
    </div>
  )

  if (wide && !isMobile) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <div className="space-y-3">{body}{submit}</div>
        <div>{side}</div>
      </div>
    )
  }
  return <div className="space-y-3">{body}{submit}{side}</div>
}
