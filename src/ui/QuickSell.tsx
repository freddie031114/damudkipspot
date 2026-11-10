import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { recordSale } from '../data/changes'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import { formatAud, parseMoney } from '../domain/money'
import { quickSale, type PaymentMethod } from '../domain/sale'
import { toTradeInInputs, type TradeInDraft } from '../domain/trade'
import type { ProfileId } from '../data/types'
import { useActingProfile, DEFAULT_NAMES } from '../lib/profile'
import { btnCls, inputCls, Modal } from './common'
import { TradeInEditor } from './TradeInEditor'

// How the customer pays whatever the trade does not cover.
const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }, { id: 'payid', label: 'PayID' },
]

export function QuickSell({ initial, onClose }: { initial?: InventoryRow; onClose: () => void }) {
  const { rows, apply } = useStore()
  const { acting } = useActingProfile()
  const ctx = useChangeCtx()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [picked, setPicked] = useState<InventoryRow | null>(initial ?? null)
  const [price, setPrice] = useState(initial ? (initial.sticker / 100).toFixed(2) : '')
  const [qty, setQty] = useState('1')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [trades, setTrades] = useState<TradeInDraft[]>([])
  const [tradeOwnerPick, setTradeOwnerPick] = useState<ProfileId | null>(null)
  const [error, setError] = useState('')
  const priceRef = useRef<HTMLInputElement>(null)

  const results = useMemo(
    () => rows.filter((r) => r.item.kind !== 'bulk' && r.qty > 0 && matchesSearch(r.item, query)).slice(0, 8),
    [rows, query],
  )
  useEffect(() => setCursor(0), [query])
  useEffect(() => { if (picked) priceRef.current?.select() }, [picked])

  const saleTotal = (parseMoney(price) ?? 0) * (Number(qty) || 0)

  function pick(r: InventoryRow) {
    setPicked(r)
    setPrice((r.sticker / 100).toFixed(2))
    setError('')
  }

  function confirm(e: FormEvent) {
    e.preventDefault()
    if (!picked || !acting) return
    try {
      const cents = parseMoney(price)
      if (cents === null) throw new Error('Enter a valid price')
      const n = Number(qty)
      const change = recordSale(
        ctx(),
        quickSale({
          soldByProfileId: acting, itemId: picked.item.id, ownerProfileId: picked.item.profileId,
          stickerPriceCents: picked.sticker, priceCents: cents, qty: n, method, tradeIns: toTradeInInputs(trades),
        }),
      )
      apply(change)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[cursor]; if (r) pick(r) }
  }

  function onSellKey(e: React.KeyboardEvent) {
    if (e.ctrlKey && /^[1-3]$/.test(e.key)) { e.preventDefault(); setMethod(METHODS[Number(e.key) - 1]!.id) }
    // Backspace in an empty price or quantity box goes back to the search (not from the trade-in boxes).
    const t = e.target as HTMLInputElement
    if (e.key === 'Backspace' && t.value === '' && (t.getAttribute('aria-label') === 'Sale price' || t.getAttribute('aria-label') === 'Quantity')) setPicked(null)
  }

  return (
    <Modal title="Quick sell" onClose={onClose}>
      {!picked ? (
        <div>
          <input className={inputCls} autoFocus placeholder="Search name, number, set…" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} aria-label="Search stock to sell" />
          <ul className="mt-2" role="listbox">
            {results.map((r, i) => (
              <li key={r.item.id} role="option" aria-selected={i === cursor}
                className={`flex cursor-pointer justify-between rounded px-2 py-1.5 ${i === cursor ? 'bg-brand text-brand-fg' : ''}`}
                onMouseEnter={() => setCursor(i)} onClick={() => pick(r)}>
                <span>{r.item.name} <span className="opacity-70">{r.item.cardNumber} {r.item.variant}</span></span>
                <span>{formatAud(r.sticker)} · {r.qty} left</span>
              </li>
            ))}
            {results.length === 0 && <li className="px-2 py-1.5 opacity-60">Nothing in stock matches.</li>}
          </ul>
        </div>
      ) : (
        <form onSubmit={confirm} onKeyDown={onSellKey}>
          <p className="mb-1 font-medium">{picked.item.name} <span className="opacity-70">{picked.item.cardNumber} {picked.item.variant}</span></p>
          <p className="mb-3 text-sm opacity-70">
            Sticker {formatAud(picked.sticker)} · {picked.qty} in stock
            {acting && picked.item.profileId !== acting && ` · ${DEFAULT_NAMES[picked.item.profileId]}'s stock`}
          </p>
          <div className="mb-3 flex gap-3">
            <label className="flex-1 text-xs font-medium">Price each (AUD)
              <input ref={priceRef} className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Sale price" />
            </label>
            <label className="w-20 text-xs font-medium">Qty
              <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" />
            </label>
          </div>
          <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Payment method">
            {METHODS.map((m, i) => (
              <button type="button" key={m.id} role="radio" aria-checked={method === m.id} onClick={() => setMethod(m.id)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-sm ${method === m.id ? 'border-brand bg-brand text-brand-fg' : 'border-line'}`}>
                {m.label} <span className="text-xs opacity-60">Ctrl+{i + 1}</span>
              </button>
            ))}
          </div>
          <details className="mb-3 rounded-lg border border-line px-2 py-1">
            <summary className="cursor-pointer text-sm font-medium">Trade-in: cards received{trades.length > 0 && <span className="ml-2 rounded-full bg-brand px-2 text-xs text-brand-fg">{trades.length}</span>}</summary>
            <div className="mt-2">
              <TradeInEditor value={trades} onChange={setTrades} owner={tradeOwnerPick ?? picked.item.profileId} onOwner={setTradeOwnerPick} saleTotalCents={saleTotal} />
            </div>
          </details>
          {error && <p role="alert" className="mb-2 text-sm text-red-500">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">{formatAud(saleTotal)}</span>
            <button className={btnCls}>{trades.length > 0 ? 'Complete trade' : 'Sell'} (Enter)</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
