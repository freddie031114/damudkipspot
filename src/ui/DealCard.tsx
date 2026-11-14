import type { Sale } from '../data/types'
import { cashLabel, type DealSummary } from '../domain/deal'
import { formatAud } from '../domain/money'
import { fmtDateTime, methodLabel, nameOf } from './format'

const KIND: Record<DealSummary['kind'], { label: string; cls: string }> = {
  sale: { label: 'Sale', cls: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' },
  trade: { label: 'Trade', cls: 'bg-brand/15 text-brand' },
  buy: { label: 'Buy', cls: 'bg-accent/20 text-accent-ink' },
}

const listCards = (parts: { qty: number; itemId: string }[], itemName: (id: string) => string) =>
  parts.map((p) => `${p.qty} × ${itemName(p.itemId)}`).join(', ')

/** One logged deal: what went out, what came in, the cash, and the profit when it is known. */
export function DealCard({ sale, summary, itemName, showName, timeOnly, onVoid }: {
  sale: Sale
  summary: DealSummary
  itemName: (id: string) => string
  showName?: string
  /** Show just the time (inside a single show) rather than the full date. */
  timeOnly?: boolean
  onVoid?: () => void
}) {
  const k = KIND[summary.kind]
  const methods = [...new Set(sale.payments.filter((p) => p.method !== 'trade').map((p) => methodLabel[p.method]))].join('+')
  const when = timeOnly ? new Date(sale.soldAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : fmtDateTime(sale.soldAt)
  // Cards that came in as two lots (a cent apart) are one card to the reader.
  const ins = new Map<string, number>()
  for (const t of sale.tradeIns ?? []) ins.set(t.itemId, (ins.get(t.itemId) ?? 0) + t.qty)
  return (
    <li className={`rounded-2xl border border-line bg-surface p-3 shadow-card ${sale.voidedAt ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${k.cls}`}>{sale.voidedAt ? 'Voided' : k.label}</span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-70">{when} · {nameOf(sale.soldByProfileId)}{showName ? ` · ${showName}` : ''}</span>
        <strong className={`shrink-0 text-base ${summary.cashCents > 0 ? 'text-emerald-600 dark:text-emerald-400' : summary.cashCents < 0 ? 'text-accent-ink' : 'text-sm font-normal opacity-60'}`}>
          {cashLabel(summary.cashCents, formatAud)}
        </strong>
      </div>
      <div className={`mt-1.5 space-y-0.5 text-sm ${sale.voidedAt ? 'line-through' : ''}`}>
        {sale.lines.length > 0 && <p><span className="mr-1.5 inline-block w-7 text-xs font-semibold uppercase text-accent-ink">Out</span>{listCards(sale.lines, itemName)}</p>}
        {ins.size > 0 && <p><span className="mr-1.5 inline-block w-7 text-xs font-semibold uppercase text-brand">In</span>{listCards([...ins].map(([itemId, qty]) => ({ itemId, qty })), itemName)}</p>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="opacity-80">
          {summary.kind === 'buy' ? `Cost ${formatAud(summary.tradeValueCents)}` : summary.profitCents === null ? 'Profit: no cost recorded' : <>Profit <strong>{formatAud(summary.profitCents)}</strong></>}
          {summary.kind === 'trade' && ` · cards in at ${formatAud(summary.tradeValueCents)}`}
          {methods && summary.cashCents !== 0 && ` · ${methods}`}
        </span>
        {onVoid && !sale.voidedAt && <button className="flex h-8 shrink-0 items-center px-2 underline" aria-label="Void this deal" onClick={onVoid}>Void</button>}
      </div>
    </li>
  )
}
