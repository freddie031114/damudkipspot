import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { updateShow, voidSale } from '../data/changes'
import { saleLineCosts } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import { summarizeDeal } from '../domain/deal'
import { formatAud } from '../domain/money'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { toggleTheme } from '../lib/theme'
import { DealCard } from '../ui/DealCard'
import { DealForm } from '../ui/DealForm'
import { methodLabel } from '../ui/format'
import { useShow } from './showSummary'

const METHODS = ['cash', 'card', 'payid'] as const

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' }) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <strong className={`truncate text-xl max-md:text-lg ${tone === 'in' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'out' ? 'text-accent-ink' : ''}`}>{value}</strong>
      <span className="text-[10px] uppercase tracking-wider opacity-60">{label}</span>
    </div>
  )
}

/**
 * The screen for the table. Every deal is logged the same way: what went out, what came in and the
 * cash either way. The header keeps a running count of the money so the till can be checked.
 */
export function ShowMode() {
  const { id } = useParams()
  const data = useShow(id)
  const { raw, apply, notify, online, pending } = useStore()
  const ctx = useChangeCtx()
  const { acting, setActing } = useActingProfile()
  const costOf = useMemo(() => saleLineCosts(raw), [raw])
  const names = useMemo(() => new Map(raw.items.map((i) => [i.id, [i.name, i.cardNumber].filter(Boolean).join(' ')])), [raw])
  const itemName = (itemId: string) => names.get(itemId) ?? 'Unknown card'

  if (!data) return <main className="p-6">That show was not found. <Link to="/shows" className="underline">Back to shows</Link></main>
  const { show, sales, summary } = data
  const live = sales.filter((s) => !s.voidedAt)
  const net = summary.moneyInCents - summary.moneyOutCents
  const byMethod = METHODS.filter((m) => summary.byMethod[m] !== 0).map((m) => `${methodLabel[m]} ${formatAud(summary.byMethod[m])}`).join(' · ')

  const recent = (
    <section aria-label="Deals at this show">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider">Deals so far</h2>
        <Link to={`/shows/${show.id}`} className="text-xs underline">Show summary</Link>
      </div>
      <ul className="space-y-2">
        {sales.slice(0, 8).map((s) => (
          <DealCard key={s.id} sale={s} summary={summarizeDeal(s, costOf)} itemName={itemName} timeOnly onVoid={() => apply(voidSale(ctx(), s), { undoable: false })} />
        ))}
        {sales.length === 0 && <li className="rounded-2xl border border-dashed border-line p-4 text-sm opacity-60">No deals yet. Log the first one and it shows up here.</li>}
      </ul>
      {sales.length > 8 && <p className="mt-2 text-xs opacity-70">Showing the latest 8 of {sales.length}. The rest are in the show summary.</p>}
    </section>
  )

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-line bg-surface px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] max-md:px-3">
        <div className="flex items-center gap-2">
          <Link to={`/shows/${show.id}`} aria-label="Exit Show mode" className="-ml-1 flex h-10 w-9 shrink-0 items-center justify-center text-3xl leading-none">‹</Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold max-md:text-base">{show.name}</h1>
          <span role="status" className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${!online ? 'bg-accent/20 text-accent-ink' : pending ? 'bg-brand/20' : 'bg-emerald-500/20'}`}>{!online ? 'Offline: saved here' : pending ? 'Syncing…' : 'Synced'}</span>
          <label className="shrink-0 text-xs"><span className="max-md:sr-only">Logging as </span>
            <select aria-label="Selling as" className="rounded-lg border border-line bg-transparent px-2 py-1 text-sm font-semibold" value={acting ?? ''} onChange={(e) => setActing(e.target.value as 'p1' | 'p2')}>
              {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
            </select>
          </label>
          <button className="shrink-0 text-sm underline max-md:hidden" onClick={toggleTheme}>Theme</button>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-3 md:max-w-2xl" aria-label="Money so far">
          <Stat label="Cash in" value={formatAud(summary.moneyInCents)} tone="in" />
          <Stat label="Cash out" value={formatAud(summary.moneyOutCents)} tone="out" />
          <Stat label="Net" value={formatAud(net)} />
          <Stat label={live.length === 1 ? 'Deal' : 'Deals'} value={String(live.length)} />
        </div>
        {byMethod && <p className="mt-1 truncate text-xs opacity-70 max-md:hidden" aria-label="Money by payment method">{byMethod}</p>}
      </header>

      {show.status === 'closed' && (
        <p className="shrink-0 border-b border-accent bg-accent/15 px-4 py-2 text-sm" role="alert">
          This show is closed. Deals you log now still count towards it.{' '}
          <button className="underline" onClick={() => { try { apply(updateShow(ctx(), show, { status: 'live' })) } catch (e) { notify((e as Error).message, true) } }}>Reopen it</button>
        </p>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-4 max-md:p-3">
        <div className="mx-auto max-w-6xl">
          <DealForm showId={show.id} wide stickySubmit side={recent} />
        </div>
      </main>
    </div>
  )
}
