import { useMemo, useState } from 'react'
import { saleLineCosts } from '../data/derive'
import { voidSale } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { formatAud } from '../domain/money'
import type { PaymentMethod } from '../domain/sale'
import { buildSalesLog, filterLog, financialYearOf, financialYearStarting, profitPerCard, salesLogCsv, toCsv, totalsOf } from '../domain/report'
import { DEFAULT_NAMES, PROFILE_IDS } from '../lib/profile'
import { useIsMobile } from '../lib/useMedia'
import { btnCls, ghostBtn } from '../ui/common'
import { DealCard } from '../ui/DealCard'
import { summarizeDeal } from '../domain/deal'
import { downloadText, fmtDateTime, methodLabel, nameOf } from '../ui/format'

type Range = 'all' | 'month' | 'lastmonth' | 'fy' | 'lastfy' | 'custom'
const MAX_ROWS = 500
const sel = 'rounded border border-line bg-transparent px-2 py-1 text-sm'

const dayStart = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d).getTime() : undefined
}

export function SalesPage() {
  const { raw, apply } = useStore()
  const ctx = useChangeCtx()
  const [tab, setTab] = useState<'deals' | 'log' | 'cards'>('deals')
  const [owner, setOwner] = useState<ProfileId | 'all'>('all')
  const [seller, setSeller] = useState<ProfileId | 'all'>('all')
  const [showId, setShowId] = useState('all')
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all')
  const [range, setRange] = useState<Range>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [voided, setVoided] = useState(false)
  const isMobile = useIsMobile()

  const all = useMemo(
    () => buildSalesLog({ sales: raw.sales, items: raw.items, showName: (id) => raw.shows.find((s) => s.id === id)?.name ?? '', costOf: saleLineCosts(raw) }),
    [raw],
  )

  const window_ = useMemo((): { from?: number; to?: number } => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    switch (range) {
      case 'month': return { from: monthStart }
      case 'lastmonth': return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), to: monthStart }
      case 'fy': { const fy = financialYearOf(now.getTime()); return { from: fy.start, to: fy.end } }
      case 'lastfy': { const fy = financialYearStarting(Number(financialYearOf(now.getTime()).label.slice(2, 6)) - 1); return { from: fy.start, to: fy.end } }
      case 'custom': { const f = dayStart(from); const t = dayStart(to); return { from: f, to: t === undefined ? undefined : t + 86_400_000 } }
      default: return {}
    }
  }, [range, from, to])

  const rows = useMemo(() => filterLog(all, { owner, seller, showId, method, includeVoided: voided, ...window_ }), [all, owner, seller, showId, method, voided, window_])
  const totals = useMemo(() => totalsOf(rows), [rows])
  const cards = useMemo(() => profitPerCard(rows), [rows])
  const fyLabel = financialYearOf(Date.now()).label

  // Whole deals (a sale, trade or buy each count once), under the same filters as the card lines.
  const costOf = useMemo(() => saleLineCosts(raw), [raw])
  const names = useMemo(() => new Map(raw.items.map((i) => [i.id, [i.name, i.cardNumber].filter(Boolean).join(' ')])), [raw])
  const itemName = (id: string) => names.get(id) ?? 'Unknown card'
  const deals = useMemo(() => raw.sales.filter((d) => {
    if (d.voidedAt && !voided) return false
    if (owner !== 'all' && !d.lines.some((l) => l.ownerProfileId === owner) && !(d.tradeIns ?? []).some((t) => t.ownerProfileId === owner)) return false
    if (seller !== 'all' && d.soldByProfileId !== seller) return false
    if (showId !== 'all' && (showId === 'none' ? d.showId !== null : d.showId !== showId)) return false
    if (window_.from !== undefined && d.soldAt < window_.from) return false
    if (window_.to !== undefined && d.soldAt >= window_.to) return false
    if (method !== 'all' && !d.payments.some((p) => p.method === method)) return false
    return true
  }).sort((a, b) => b.soldAt - a.soldAt).map((d) => ({ sale: d, sum: summarizeDeal(d, costOf) })), [raw, costOf, owner, seller, showId, method, voided, window_])
  const money = useMemo(() => {
    let cashIn = 0, cashOut = 0, count = 0
    for (const d of deals) {
      if (d.sale.voidedAt) continue
      count++
      for (const p of d.sale.payments) if (p.method !== 'trade') { if (p.amountCents >= 0) cashIn += p.amountCents; else cashOut -= p.amountCents }
    }
    return { cashIn, cashOut, count }
  }, [deals])

  const filters = (
  <div className="mb-3 flex flex-wrap items-end gap-3" aria-label="Filters">
    <label className="text-xs">Stock of
      <select className={`${sel} block`} value={owner} onChange={(e) => setOwner(e.target.value as ProfileId | 'all')}><option value="all">Everyone</option>{PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}</select></label>
    <label className="text-xs">Sold by
      <select className={`${sel} block`} value={seller} onChange={(e) => setSeller(e.target.value as ProfileId | 'all')}><option value="all">Anyone</option>{PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}</select></label>
    <label className="text-xs">Show
      <select className={`${sel} block`} value={showId} onChange={(e) => setShowId(e.target.value)}>
        <option value="all">Everywhere</option><option value="none">Not at a show</option>
        {raw.shows.filter((s) => !s.deletedAt).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
    <label className="text-xs">Payment
      <select className={`${sel} block`} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | 'all')}><option value="all">Any</option>{(['cash', 'card', 'payid', 'trade'] as const).map((m) => <option key={m} value={m}>{methodLabel[m]}</option>)}</select></label>
    <label className="text-xs">Dates
      <select className={`${sel} block`} aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value as Range)}>
        <option value="all">All time</option><option value="month">This month</option><option value="lastmonth">Last month</option>
        <option value="fy">This financial year ({fyLabel})</option><option value="lastfy">Last financial year</option><option value="custom">Custom…</option>
      </select></label>
    {range === 'custom' && <>
      <label className="text-xs">From<input className={`${sel} block`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="text-xs">To<input className={`${sel} block`} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
    </>}
    <label className="flex items-center gap-1 pb-1 text-xs"><input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} /> Show voided</label>
  </div>
  )

  const exportLog = () => downloadText(`sales-${new Date().toISOString().slice(0, 10)}.csv`, salesLogCsv(rows, nameOf))
  const exportDeals = () =>
    downloadText(`deals-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      ['When', 'Type', 'Show', 'Logged by', 'Cards out', 'Cards in', 'Cash in/out (AUD)', 'Paid by', 'Cards in valued at (AUD)', 'Counted as sold for (AUD)', 'Profit (AUD)', 'Voided'],
      ...deals.map(({ sale: d, sum }) => [
        fmtDateTime(d.soldAt), sum.kind, raw.shows.find((x) => x.id === d.showId)?.name ?? '', nameOf(d.soldByProfileId),
        d.lines.map((l) => `${l.qty} x ${itemName(l.itemId)}`).join('; '), (d.tradeIns ?? []).map((t) => `${t.qty} x ${itemName(t.itemId)}`).join('; '),
        (sum.cashCents / 100).toFixed(2), [...new Set(d.payments.filter((x) => x.method !== 'trade').map((x) => methodLabel[x.method]))].join('+'),
        (sum.tradeValueCents / 100).toFixed(2), (sum.revenueCents / 100).toFixed(2), sum.profitCents === null ? '' : (sum.profitCents / 100).toFixed(2), d.voidedAt ? 'Yes' : 'No',
      ]),
    ]))
  const exportCards = () =>
    downloadText(`profit-per-card-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      ['Item', 'Qty sold', 'Revenue (AUD)', 'Cost (AUD)', 'Profit (AUD)', 'Units with cost unknown'],
      ...cards.map((c) => [c.name, c.qty, (c.revenueCents / 100).toFixed(2), (c.costCents / 100).toFixed(2), (c.profitCents / 100).toFixed(2), c.unknownCostQty]),
    ]))

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-5 md:p-7">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">Sales</h1>
      {isMobile ? (
        <details className="mb-3 rounded-xl border border-line bg-surface px-3 py-2">
          <summary className="flex min-h-9 cursor-pointer items-center text-sm font-medium">Filters{(owner !== 'all' || seller !== 'all' || showId !== 'all' || method !== 'all' || range !== 'all' || voided) && <span className="ml-2 rounded-full bg-brand px-2 text-xs text-brand-fg">on</span>}<span className="ml-auto opacity-60" aria-hidden="true">▾</span></summary>
          <div className="mt-2">{filters}</div>
        </details>
      ) : filters}

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-line bg-surface shadow-card px-3 py-2 text-sm" aria-label="Totals">
        {tab === 'deals' ? <>
          <span><strong>{money.count}</strong> deal{money.count === 1 ? '' : 's'}</span>
          <span>Cash in <strong className="text-emerald-600 dark:text-emerald-400">{formatAud(money.cashIn)}</strong></span>
          <span>Cash out <strong className="text-accent-ink">{formatAud(money.cashOut)}</strong></span>
          <span>Net cash <strong>{formatAud(money.cashIn - money.cashOut)}</strong></span>
          <span>Profit <strong>{formatAud(totals.profitCents)}</strong></span>
        </> : <>
          <span><strong>{totals.count}</strong> line{totals.count === 1 ? '' : 's'}</span>
          <span>Counted as sold for <strong>{formatAud(totals.revenueCents)}</strong></span>
          <span>Cost <strong>{formatAud(totals.costCents)}</strong></span>
          <span>Profit <strong>{formatAud(totals.profitCents)}</strong></span>
        </>}
        {totals.unknownCostRevenueCents > 0 && <span className="text-accent-ink">Profit leaves out cards with no cost recorded ({formatAud(totals.unknownCostRevenueCents)} worth)</span>}
        <span className="ml-auto flex gap-2">
          <button className={ghostBtn} onClick={tab === 'cards' ? exportCards : tab === 'deals' ? exportDeals : exportLog} disabled={tab === 'deals' ? deals.length === 0 : rows.length === 0}>Export CSV</button>
        </span>
      </div>

      <div className="mb-2 flex gap-1" role="tablist">
        {([['deals', 'Deals'], ['log', 'Cards sold'], ['cards', 'Profit per card']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? 'bg-brand text-brand-fg' : 'hover:bg-hover'}`}>{label}</button>
        ))}
      </div>

      {tab === 'deals' ? (
        deals.length === 0 ? <p className="opacity-70">No deals match these filters. Log one with the Deal button, or in Show mode.</p> : (
          <>
            <ul className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3" aria-label="Deals">
              {deals.slice(0, MAX_ROWS).map(({ sale: d, sum }) => (
                <DealCard key={d.id} sale={d} summary={sum} itemName={itemName} showName={raw.shows.find((x) => x.id === d.showId)?.name}
                  onVoid={() => apply(voidSale(ctx(), d), { undoable: false })} />
              ))}
            </ul>
            {deals.length > MAX_ROWS && <p className="mt-2 text-xs opacity-70">Showing the newest {MAX_ROWS} of {deals.length} deals. Export CSV includes all of them.</p>}
          </>
        )
      ) : rows.length === 0 ? <p className="opacity-70">No cards sold match these filters.</p>
      : tab === 'log' && isMobile ? (
        <>
          <ul className="space-y-2" aria-label="Sales log">
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <li key={r.saleId + i} className={`rounded-2xl border border-line bg-surface p-3 shadow-card ${r.voided ? 'line-through opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.itemName} <span className="text-xs font-normal opacity-60">{r.cardNumber}</span></p>
                    <p className="text-xs opacity-70">{fmtDateTime(r.soldAt)}{r.showName && <> · {r.showName}</>}</p>
                  </div>
                  <strong className="shrink-0">{formatAud(r.revenueCents)}</strong>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs">
                  <span className="opacity-80">{r.qty} × {formatAud(r.unitPriceCents)} · {r.methods.map((m) => methodLabel[m]).join('+')} · {nameOf(r.soldBy)}'s sale of {nameOf(r.owner)}'s stock</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span>{r.profitCents === null ? <span className="opacity-60">no cost recorded</span> : <>Profit <strong>{formatAud(r.profitCents)}</strong></>}</span>
                  {!r.voided && <button className="flex h-9 items-center px-2 underline" onClick={() => { const sale = raw.sales.find((x) => x.id === r.saleId); if (sale) apply(voidSale(ctx(), sale), { undoable: false }) }}>Void</button>}
                </div>
              </li>
            ))}
          </ul>
          {rows.length > MAX_ROWS && <p className="mt-2 text-xs opacity-70">Showing the newest {MAX_ROWS} of {rows.length} lines. Export CSV includes all of them.</p>}
        </>
      ) : tab === 'log' ? (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase"><tr><th className="py-1">When</th><th>Item</th><th>Show</th><th>Sold by</th><th>Stock of</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th>Paid</th><th /></tr></thead>
            <tbody>
              {rows.slice(0, MAX_ROWS).map((r, i) => (
                <tr key={r.saleId + i} className={`border-t border-line ${r.voided ? 'line-through opacity-50' : ''}`}>
                  <td className="py-1">{fmtDateTime(r.soldAt)}</td><td>{r.itemName} <span className="opacity-60">{r.cardNumber}</span></td><td>{r.showName || '—'}</td>
                  <td>{nameOf(r.soldBy)}</td><td>{nameOf(r.owner)}</td><td className="text-right">{r.qty}</td><td className="text-right">{formatAud(r.unitPriceCents)}</td>
                  <td className="text-right">{formatAud(r.revenueCents)}</td>
                  <td className="text-right">{r.profitCents === null ? <span title="Cost not recorded" className="opacity-60">no cost</span> : formatAud(r.profitCents)}</td>
                  <td>{r.methods.map((m) => methodLabel[m]).join('+')}</td>
                  <td>{!r.voided && <button className="text-xs underline" onClick={() => { const s = raw.sales.find((x) => x.id === r.saleId); if (s) apply(voidSale(ctx(), s), { undoable: false }) }}>Void</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_ROWS && <p className="mt-2 text-xs opacity-70">Showing the newest {MAX_ROWS} of {rows.length} lines. Export CSV includes all of them.</p>}
        </>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase"><tr><th className="py-1">Item</th><th className="text-right">Sold</th><th className="text-right">Revenue</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">No cost recorded</th></tr></thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.itemId} className="border-t border-line">
                <td className="py-1">{c.name}</td><td className="text-right">{c.qty}</td><td className="text-right">{formatAud(c.revenueCents)}</td>
                <td className="text-right">{formatAud(c.costCents)}</td><td className="text-right font-medium">{formatAud(c.profitCents)}</td>
                <td className="text-right">{c.unknownCostQty > 0 ? `${c.unknownCostQty} sold` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-4"><button className={btnCls} onClick={exportLog} disabled={rows.length === 0}>Download sales CSV (for tax time)</button></p>
    </main>
  )
}
