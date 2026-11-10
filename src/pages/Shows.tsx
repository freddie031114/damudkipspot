import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createShow } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { formatAud, parseMoney } from '../domain/money'
import { summarizeShow } from '../domain/show'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { btnCls, ghostBtn, inputCls } from '../ui/common'
import { fmtIsoDay, today } from '../ui/format'

export const statusStyle = { planned: 'bg-chip', live: 'bg-emerald-500/25', closed: 'bg-accent/20' } as const

export function ShowsPage() {
  const { raw, apply, notify } = useStore()
  const ctx = useChangeCtx()
  const { acting } = useActingProfile()
  const navigate = useNavigate()
  const [open, setOpen] = useState(raw.shows.length === 0)
  const [f, setF] = useState({ name: '', startsOn: today(), endsOn: '', venue: '', fee: '', paidBy: (acting ?? 'p1') as ProfileId })

  const shows = useMemo(
    () => raw.shows.filter((s) => !s.deletedAt).sort((a, b) => (b.startsOn || '').localeCompare(a.startsOn || '')),
    [raw.shows],
  )

  function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const fee = f.fee.trim() === '' ? 0 : parseMoney(f.fee)
      if (fee === null) throw new Error('Table fee is not a valid amount')
      const change = createShow(ctx(), { name: f.name, startsOn: f.startsOn, endsOn: f.endsOn || f.startsOn, venue: f.venue, tableFeeCents: fee, feePaidBy: f.paidBy })
      apply(change)
      navigate(`/shows/${change.showId}`)
    } catch (err) {
      notify((err as Error).message, true)
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Shows</h1>
        <button className={btnCls} onClick={() => setOpen(!open)}>{open ? 'Cancel' : 'New show'}</button>
      </div>

      {open && (
        <form onSubmit={submit} className="mb-4 grid max-w-3xl grid-cols-6 gap-3 rounded-lg border border-line bg-surface p-4" aria-label="New show">
          <label className="col-span-6 text-xs font-medium sm:col-span-3">Show name<input className={inputCls} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Brisbane Card Show" /></label>
          <label className="col-span-3 text-xs font-medium sm:col-span-1">Starts<input className={inputCls} type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></label>
          <label className="col-span-3 text-xs font-medium sm:col-span-1">Ends<input className={inputCls} type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></label>
          <label className="col-span-6 text-xs font-medium sm:col-span-1">Table fee<input className={inputCls} inputMode="decimal" placeholder="$" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></label>
          <label className="col-span-4 text-xs font-medium">Venue<input className={inputCls} value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></label>
          <label className="col-span-2 text-xs font-medium">Fee paid by
            <select className={inputCls} value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value as ProfileId })}>
              {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
            </select>
          </label>
          <p className="col-span-6 text-xs opacity-70">The table fee is added as an expense split 50/50. You can change the split or add other costs on the show page.</p>
          <div className="col-span-6 flex justify-end"><button className={btnCls}>Create show</button></div>
        </form>
      )}

      {shows.length === 0 && !open && <p className="opacity-70">No shows yet. Create one to track takings and split costs.</p>}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shows.map((s) => {
          const sum = summarizeShow({
            sales: raw.sales.filter((x) => x.showId === s.id), expenses: raw.showExpenses.filter((e) => e.showId === s.id), participants: s.participants,
            costOf: () => ({ knownCostCents: 0, unknownCostQty: 0, oversoldQty: 0 }),
          })
          return (
            <li key={s.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/shows/${s.id}`} className="text-lg font-semibold underline">{s.name}</Link>
                <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${statusStyle[s.status]}`}>{s.status}</span>
              </div>
              <p className="text-sm opacity-70">{fmtIsoDay(s.startsOn)}{s.endsOn && s.endsOn !== s.startsOn ? ` – ${fmtIsoDay(s.endsOn)}` : ''}{s.venue ? ` · ${s.venue}` : ''}</p>
              <p className="mt-2 text-sm">{sum.salesCount} sales · takings <strong>{formatAud(sum.totalCents)}</strong> · costs {formatAud(sum.expensesTotalCents)}</p>
              <div className="mt-2 flex gap-2">
                <Link to={`/shows/${s.id}`} className={ghostBtn}>Open</Link>
                {s.status !== 'closed' && <Link to={`/show/${s.id}`} className={btnCls}>Show mode</Link>}
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
