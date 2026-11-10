import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addExpense, deleteExpense, setParticipant, updateShow, voidSale, type ShowEdit } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { formatAud, parseMoney } from '../domain/money'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { btnCls, ghostBtn, inputCls } from '../ui/common'
import { fmtDateTime, methodLabel, nameOf } from '../ui/format'
import { statusStyle } from './Shows'
import { useShow } from './showSummary'

const lbl = 'block text-xs font-medium'
const box = 'rounded-lg border border-line bg-surface p-4'

export function ShowDetail() {
  const { id } = useParams()
  const data = useShow(id)
  const { apply, notify } = useStore()
  const ctx = useChangeCtx()
  const { acting } = useActingProfile()
  const [exp, setExp] = useState({ description: '', amount: '', paidBy: (acting ?? 'p1') as ProfileId, custom: false, pct: '50' })

  if (!data) return <main className="p-6">That show was not found. <Link to="/shows" className="underline">Back to shows</Link></main>
  const { show, sales, expenses, summary } = data
  const edit = (e: ShowEdit) => {
    try { apply(updateShow(ctx(), show, e)) } catch (err) { notify((err as Error).message, true) }
  }
  const money = (s: string) => parseMoney(s)

  function addExp(e: FormEvent) {
    e.preventDefault()
    try {
      const cents = money(exp.amount)
      if (cents === null) throw new Error('Enter a valid amount')
      const pct1 = exp.custom ? Number(exp.pct) : 50
      if (!Number.isInteger(pct1) || pct1 < 0 || pct1 > 100) throw new Error(`${DEFAULT_NAMES.p1}'s share must be a whole number from 0 to 100`)
      apply(addExpense(ctx(), show.id, { description: exp.description, amountCents: cents, paidBy: exp.paidBy, splitPct: { p1: pct1, p2: 100 - pct1 } }))
      setExp({ ...exp, description: '', amount: '' })
    } catch (err) {
      notify((err as Error).message, true)
    }
  }

  const s = summary
  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link to="/shows" className="text-sm underline">‹ Shows</Link>
        <h1 className="text-xl font-semibold">{show.name}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${statusStyle[show.status]}`}>{show.status}</span>
        <span className="ml-auto flex gap-2">
          {show.status === 'planned' && <button className={btnCls} onClick={() => edit({ status: 'live' })}>Start show</button>}
          {show.status === 'live' && <Link to={`/show/${show.id}`} className={btnCls}>Open Show mode</Link>}
          {show.status === 'live' && <button className={ghostBtn} onClick={() => edit({ status: 'closed' })}>Close show</button>}
          {show.status === 'closed' && <button className={ghostBtn} onClick={() => edit({ status: 'live' })}>Reopen</button>}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className={box} aria-label="Show details">
          <h2 className="mb-2 font-semibold">Details</h2>
          <div className="grid grid-cols-6 gap-3" key={show.updatedAt}>
            <label className={`${lbl} col-span-6`}>Name<input className={inputCls} defaultValue={show.name} onBlur={(e) => edit({ name: e.target.value })} /></label>
            <label className={`${lbl} col-span-3`}>Starts<input className={inputCls} type="date" defaultValue={show.startsOn} onBlur={(e) => edit({ startsOn: e.target.value })} /></label>
            <label className={`${lbl} col-span-3`}>Ends<input className={inputCls} type="date" defaultValue={show.endsOn} onBlur={(e) => edit({ endsOn: e.target.value })} /></label>
            <label className={`${lbl} col-span-4`}>Venue<input className={inputCls} defaultValue={show.venue} onBlur={(e) => edit({ venue: e.target.value.trim() })} /></label>
            <label className={`${lbl} col-span-2`}>Table fee
              <input className={inputCls} inputMode="decimal" defaultValue={(show.tableFeeCents / 100).toFixed(2)}
                onBlur={(e) => { const c = money(e.target.value); if (c === null || c < 0) notify('Enter a valid table fee', true); else edit({ tableFeeCents: c }) }} />
            </label>
            <label className={`${lbl} col-span-6`}>Notes<textarea className={`${inputCls} h-14`} defaultValue={show.notes} onBlur={(e) => edit({ notes: e.target.value })} /></label>
          </div>
        </section>

        <section className={box} aria-label="Cash">
          <h2 className="mb-2 font-semibold">Cash float and count</h2>
          <p className="mb-2 text-xs opacity-70">Opening float is the cash you brought for change. Count the cash at the end to check it against what the sales say it should be.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase"><tr><th className="py-1">Person</th><th>Opening float</th><th>Cash sales</th><th>Expected</th><th>Counted</th><th>Difference</th></tr></thead>
            <tbody>
              {PROFILE_IDS.map((p) => {
                const part = show.participants.find((x) => x.profileId === p)
                const pp = s.perProfile[p]
                const set = (patch: { openingFloatCents?: number; closingCashCents?: number | null }) => { try { apply(setParticipant(ctx(), show, p, patch)) } catch (err) { notify((err as Error).message, true) } }
                return (
                  <tr key={p} className="border-t border-line">
                    <td className="py-1 font-medium">{nameOf(p)}</td>
                    <td><input className="w-24 rounded border border-line bg-transparent px-1" aria-label={`${nameOf(p)} opening float`} inputMode="decimal" key={`f${show.updatedAt}`} defaultValue={((part?.openingFloatCents ?? 0) / 100).toFixed(2)}
                      onBlur={(e) => { const c = money(e.target.value); if (c === null || c < 0) notify('Enter a valid amount', true); else if (c !== (part?.openingFloatCents ?? 0)) set({ openingFloatCents: c }) }} /></td>
                    <td>{formatAud(pp.cashCollectedCents)}</td>
                    <td>{formatAud(pp.expectedCashCents)}</td>
                    <td><input className="w-24 rounded border border-line bg-transparent px-1" aria-label={`${nameOf(p)} counted cash`} inputMode="decimal" placeholder="not counted" key={`c${show.updatedAt}`}
                      defaultValue={part?.closingCashCents == null ? '' : (part.closingCashCents / 100).toFixed(2)}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v === '') { if (part?.closingCashCents != null) set({ closingCashCents: null }); return } const c = money(v); if (c === null || c < 0) notify('Enter a valid amount', true); else if (c !== part?.closingCashCents) set({ closingCashCents: c }) }} /></td>
                    <td className={pp.cashDifferenceCents ? 'font-semibold text-accent-ink' : ''}>{pp.cashDifferenceCents === null ? '—' : pp.cashDifferenceCents === 0 ? 'Matches' : `${pp.cashDifferenceCents > 0 ? '+' : ''}${formatAud(pp.cashDifferenceCents)}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className={box} aria-label="Costs">
          <h2 className="mb-2 font-semibold">Shared costs</h2>
          <table className="mb-3 w-full text-sm">
            <thead className="text-left text-xs uppercase"><tr><th className="py-1">Cost</th><th>Paid by</th><th>Split</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1">{e.description}</td><td>{nameOf(e.paidByProfileId)}</td>
                  <td>{e.splitPct.p1 === 50 ? 'Equal' : `${e.splitPct.p1}% / ${e.splitPct.p2}%`}</td>
                  <td className="text-right">{formatAud(e.amountCents)}</td>
                  <td className="text-right"><button className="text-xs underline" onClick={() => apply(deleteExpense(ctx(), e))}>Remove</button></td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={5} className="py-2 opacity-60">No costs yet.</td></tr>}
              {expenses.length > 0 && <tr className="border-t border-line font-semibold"><td className="py-1" colSpan={3}>Total</td><td className="text-right">{formatAud(s.expensesTotalCents)}</td><td /></tr>}
            </tbody>
          </table>
          <form onSubmit={addExp} className="flex flex-wrap items-end gap-2" aria-label="Add cost">
            <label className={lbl}>Cost<input className={`${inputCls} w-40`} value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} placeholder="Parking, lunch…" /></label>
            <label className={lbl}>Amount<input className={`${inputCls} w-24`} inputMode="decimal" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder="$" /></label>
            <label className={lbl}>Paid by
              <select className={inputCls} value={exp.paidBy} onChange={(e) => setExp({ ...exp, paidBy: e.target.value as ProfileId })}>{PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}</select>
            </label>
            <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" checked={exp.custom} onChange={(e) => setExp({ ...exp, custom: e.target.checked })} /> Custom split</label>
            {exp.custom && <label className={lbl}>{DEFAULT_NAMES.p1} %<input className={`${inputCls} w-16`} inputMode="numeric" value={exp.pct} onChange={(e) => setExp({ ...exp, pct: e.target.value })} /></label>}
            <button className={btnCls}>Add</button>
          </form>
        </section>

        <section className={box} aria-label="Summary">
          <h2 className="mb-2 font-semibold">Show summary</h2>
          <p className="mb-2 text-sm">{s.salesCount} sales · takings <strong>{formatAud(s.totalCents)}</strong>
            {' '}({(['cash', 'card', 'payid', 'trade'] as const).filter((m) => s.byMethod[m] > 0).map((m) => `${methodLabel[m]} ${formatAud(s.byMethod[m])}`).join(', ') || 'no payments yet'})</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase"><tr><th className="py-1" /><th className="text-right">{DEFAULT_NAMES.p1}</th><th className="text-right">{DEFAULT_NAMES.p2}</th></tr></thead>
            <tbody>
              {([
                ['Sales of own stock', (p: ProfileId) => s.perProfile[p].revenueCents],
                ['Cost of those cards', (p: ProfileId) => s.perProfile[p].knownCostCents],
                ['Profit (known cost only)', (p: ProfileId) => s.perProfile[p].profitCents],
                ['Share of costs', (p: ProfileId) => s.perProfile[p].expenseShareCents],
                ['Profit after costs', (p: ProfileId) => s.perProfile[p].netProfitCents],
                ['Sales with cost unknown', (p: ProfileId) => s.perProfile[p].unknownCostRevenueCents],
              ] as const).map(([label, fn]) => (
                <tr key={label} className={`border-t border-line ${label === 'Profit after costs' ? 'font-semibold' : ''}`}>
                  <td className="py-1">{label}</td><td className="text-right">{formatAud(fn('p1'))}</td><td className="text-right">{formatAud(fn('p2'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 rounded bg-chip px-3 py-2 text-sm" role="status" aria-label="Settlement">
            {s.settlement
              ? <>To square up: <strong>{nameOf(s.settlement.from)}</strong> pays <strong>{nameOf(s.settlement.to)}</strong> <strong>{formatAud(s.settlement.amountCents)}</strong>. This covers money taken for the other person's cards and shared costs.</>
              : 'Nobody owes anything: each person took the money for their own cards and costs are even.'}
          </p>
          {s.perProfile.p1.unknownCostRevenueCents + s.perProfile.p2.unknownCostRevenueCents > 0 && (
            <p className="mt-2 text-xs opacity-70">Some sold cards have no cost recorded, so their sales are left out of profit. Add costs in the item's stock lots to include them.</p>
          )}
        </section>

        <section className={`${box} xl:col-span-2`} aria-label="Show sales">
          <h2 className="mb-2 font-semibold">Sales at this show</h2>
          {sales.length === 0 ? <p className="text-sm opacity-70">No sales recorded at this show yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase"><tr><th className="py-1">When</th><th>Items</th><th>Sold by</th><th>Paid</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {sales.map((sale) => {
                  const total = sale.lines.reduce((n, l) => n + l.qty * l.unitPriceCents, 0) - sale.discountCents
                  return (
                    <tr key={sale.id} className={`border-t border-line ${sale.voidedAt ? 'line-through opacity-50' : ''}`}>
                      <td className="py-1">{fmtDateTime(sale.soldAt)}</td><td>{sale.lines.length} line(s)</td><td>{nameOf(sale.soldByProfileId)}</td>
                      <td>{[...new Set(sale.payments.map((p) => methodLabel[p.method]))].join(' + ')}</td>
                      <td className="text-right">{formatAud(total)}</td>
                      <td className="text-right">{!sale.voidedAt && <button className="text-xs underline" onClick={() => apply(voidSale(ctx(), sale), { undoable: false })}>Void</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  )
}
