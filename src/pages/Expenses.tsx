import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { addExpense, deleteExpense, settleExpenses } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId, ShowExpense } from '../data/types'
import { categoryOf, EXPENSE_CATEGORIES, expenseBalance, isoDay } from '../domain/expenses'
import { formatAud, parseMoney } from '../domain/money'
import { toCsv } from '../domain/report'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { btnCls, ghostBtn, inputCls } from '../ui/common'
import { downloadText, fmtIsoDay, nameOf, today } from '../ui/format'

const lbl = 'block text-xs font-medium'
const box = 'rounded-2xl border border-line bg-surface shadow-card p-4'
const sel = 'rounded border border-line bg-transparent px-2 py-1 text-sm'

const dayOf = (e: ShowExpense) => e.incurredOn ?? isoDay(e.createdAt)

/** Everything the two of you spend on the business (table fees, travel, supplies…) and who owes whom. */
export function ExpensesPage() {
  const { raw, apply, notify } = useStore()
  const ctx = useChangeCtx()
  const { acting } = useActingProfile()
  const [showFilter, setShowFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('all')
  const [showSettled, setShowSettled] = useState(false)
  const [f, setF] = useState({ description: '', amount: '', category: 'Table fee' as string, date: today(), paidBy: (acting ?? 'p1') as ProfileId, showId: '', custom: false, pct: '50' })

  const showName = useMemo(() => new Map(raw.shows.map((s) => [s.id, s.name])), [raw])

  const all = useMemo(
    () => raw.showExpenses.filter((e) => !e.deletedAt).sort((a, b) => (dayOf(a) < dayOf(b) ? 1 : dayOf(a) > dayOf(b) ? -1 : b.createdAt - a.createdAt)),
    [raw],
  )
  const inFilter = useMemo(
    () => all.filter((e) => (showFilter === 'all' || (showFilter === 'none' ? !e.showId : e.showId === showFilter)) && (catFilter === 'all' || categoryOf(e) === catFilter)),
    [all, showFilter, catFilter],
  )
  const open = useMemo(() => inFilter.filter((e) => !e.settledAt), [inFilter])
  const listed = showSettled ? inFilter : open
  const owed = useMemo(() => expenseBalance(open), [open])
  const totalListed = listed.reduce((n, e) => n + e.amountCents, 0)

  function add(ev: FormEvent) {
    ev.preventDefault()
    try {
      const cents = parseMoney(f.amount)
      if (cents === null) throw new Error('Enter a valid amount')
      const pct1 = f.custom ? Number(f.pct) : 50
      if (!Number.isInteger(pct1) || pct1 < 0 || pct1 > 100) throw new Error(`${DEFAULT_NAMES.p1}'s share must be a whole number from 0 to 100`)
      apply(addExpense(ctx(), f.showId || null, {
        description: f.description.trim() || f.category, amountCents: cents, paidBy: f.paidBy, category: f.category, incurredOn: f.date,
        splitPct: { p1: pct1, p2: 100 - pct1 },
      }))
      setF({ ...f, description: '', amount: '' })
    } catch (err) {
      notify((err as Error).message, true)
    }
  }

  const settle = () => {
    try { apply(settleExpenses(ctx(), open)) } catch (err) { notify((err as Error).message, true) }
  }

  const exportCsv = () =>
    downloadText(`expenses-${today()}.csv`, toCsv([
      ['Date', 'Description', 'Category', 'Show', 'Paid by', `${DEFAULT_NAMES.p1} share %`, `${DEFAULT_NAMES.p2} share %`, 'Amount (AUD)', 'Settled'],
      ...listed.map((e) => [dayOf(e), e.description, categoryOf(e), e.showId ? showName.get(e.showId) ?? '' : '', nameOf(e.paidByProfileId), e.splitPct.p1, e.splitPct.p2, (e.amountCents / 100).toFixed(2), e.settledAt ? 'Yes' : 'No']),
    ]))

  const s = owed.settlement
  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-5 md:p-7">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        <span className="text-sm opacity-70">Table fees, travel, supplies: whatever you split between you.</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <section className="min-w-0 space-y-4" aria-label="Who owes whom">
          <div className={`${box} flex flex-wrap items-center gap-x-8 gap-y-3`}>
            <div className="flex flex-col leading-tight"><strong className="text-2xl font-semibold">{formatAud(owed.totalCents)}</strong><span className="text-[11px] uppercase tracking-wider opacity-60">Not yet settled</span></div>
            {PROFILE_IDS.map((p) => (
              <div key={p} className="flex flex-col leading-tight">
                <strong className="text-lg font-semibold">{formatAud(owed.paidCents[p])}</strong>
                <span className="text-[11px] uppercase tracking-wider opacity-60">{DEFAULT_NAMES[p]} paid · share {formatAud(owed.shareCents[p])}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-3">
              <p className="rounded-xl bg-hover/70 px-3 py-2 text-sm" role="status" aria-label="Balance">
                {s ? <><strong>{nameOf(s.from)}</strong> owes <strong>{nameOf(s.to)}</strong> <strong className="text-lg">{formatAud(s.amountCents)}</strong></> : open.length ? 'You are square: each has paid their share.' : 'Nothing to settle.'}
              </p>
              <button className={btnCls} onClick={settle} disabled={open.length === 0} title="Mark everything listed as paid back">Settle up</button>
            </div>
          </div>
          <p className="-mt-2 text-xs opacity-70">
            Costs added to a show also count in that show's own settlement on the <Link to="/shows" className="underline">Shows</Link> page, so pay each one back only once. “Settle up” applies to the costs matching the filters below.
          </p>

          <div className="flex flex-wrap items-end gap-3" aria-label="Filters">
            <label className="text-xs">Show
              <select className={`${sel} block`} value={showFilter} onChange={(e) => setShowFilter(e.target.value)}>
                <option value="all">All costs</option><option value="none">Not at a show</option>
                {raw.shows.filter((x) => !x.deletedAt).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></label>
            <label className="text-xs">Category
              <select className={`${sel} block`} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="all">Any</option>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select></label>
            <label className="flex items-center gap-1 pb-1 text-xs"><input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} /> Show settled</label>
            <button className={`${ghostBtn} ml-auto`} onClick={exportCsv} disabled={listed.length === 0}>Export CSV</button>
          </div>

          <div className={`${box} !p-0 overflow-x-auto`}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase"><tr className="border-b border-line"><th className="px-4 py-2">Date</th><th>Cost</th><th>Category</th><th>Show</th><th>Paid by</th><th>Split</th><th className="text-right">Amount</th><th className="pr-4" /></tr></thead>
              <tbody>
                {listed.map((e) => (
                  <tr key={e.id} className={`border-t border-line ${e.settledAt ? 'opacity-55' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-1.5">{fmtIsoDay(dayOf(e))}</td>
                    <td>{e.description}{e.settledAt && <span className="ml-2 rounded-full bg-chip px-1.5 text-[10px] text-ink">settled</span>}</td>
                    <td>{categoryOf(e)}</td>
                    <td>{e.showId ? <Link className="underline" to={`/shows/${e.showId}`}>{showName.get(e.showId) ?? 'Show'}</Link> : <span className="opacity-50">—</span>}</td>
                    <td>{nameOf(e.paidByProfileId)}</td>
                    <td>{e.splitPct.p1 === 50 ? 'Equal' : `${e.splitPct.p1}% / ${e.splitPct.p2}%`}</td>
                    <td className="text-right">{formatAud(e.amountCents)}</td>
                    <td className="pr-4 text-right"><button className="text-xs underline" aria-label={`Remove ${e.description}`} onClick={() => apply(deleteExpense(ctx(), e))}>Remove</button></td>
                  </tr>
                ))}
                {listed.length === 0 && <tr><td colSpan={8} className="px-4 py-4 opacity-60">{all.length === 0 ? 'No costs yet. Add the table fee or anything else you are splitting.' : 'Nothing matches. All costs here are settled, or the filters are too narrow.'}</td></tr>}
                {listed.length > 0 && <tr className="border-t border-line font-semibold"><td className="px-4 py-1.5" colSpan={6}>Total ({listed.length})</td><td className="text-right">{formatAud(totalListed)}</td><td /></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${box} h-fit`} aria-label="Add a cost">
          <h2 className="mb-2 font-semibold">Add a cost</h2>
          <form onSubmit={add} className="grid grid-cols-2 gap-3" aria-label="Add cost">
            <label className={`${lbl} col-span-2`}>Category
              <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className={`${lbl} col-span-2`}>What for (optional)
              <input className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={f.category === 'Table fee' ? 'Brisbane show table' : 'Parking, toploaders…'} /></label>
            <label className={lbl}>Amount
              <input className={inputCls} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="$" aria-label="Amount" /></label>
            <label className={lbl}>Date
              <input className={inputCls} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label className={lbl}>Paid by
              <select className={inputCls} value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value as ProfileId })}>{PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}</select></label>
            <label className={lbl}>Show (optional)
              <select className={inputCls} value={f.showId} onChange={(e) => setF({ ...f, showId: e.target.value })}>
                <option value="">No show</option>{raw.shows.filter((x) => !x.deletedAt).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></label>
            <div className="col-span-2 flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1"><input type="checkbox" checked={f.custom} onChange={(e) => setF({ ...f, custom: e.target.checked })} /> Custom split</label>
              {f.custom
                ? <label className="flex items-center gap-1 text-xs">{DEFAULT_NAMES.p1} pays <input className={`${inputCls} !w-16`} inputMode="numeric" aria-label={`${DEFAULT_NAMES.p1} share percent`} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} />% · {DEFAULT_NAMES.p2} {100 - (Number(f.pct) || 0)}%</label>
                : <span className="text-xs opacity-70">Split 50 / 50</span>}
            </div>
            <div className="col-span-2 flex justify-end"><button className={btnCls}>Add cost</button></div>
          </form>
        </section>
      </div>
    </main>
  )
}
