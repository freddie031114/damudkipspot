import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { saleLineCosts } from '../data/derive'
import { useStore } from '../data/store'
import { formatAud } from '../domain/money'
import { buildSalesLog, filterLog, totalsOf } from '../domain/report'
import { fmtDateTime, nameOf } from '../ui/format'
import { useUi } from '../ui/UiContext'

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs opacity-70">{sub}</div>}
    </div>
  )
}

const DAY = 86_400_000

export function Dashboard() {
  const { rows, raw } = useStore()
  const { view, openItem } = useUi()
  const scoped = useMemo(() => rows.filter((r) => view === 'all' || r.item.profileId === view), [rows, view])

  const stats = useMemo(() => {
    const priced = scoped.filter((r) => r.qty > 0)
    const known = priced.filter((r) => !r.costUnknown)
    return {
      items: priced.length,
      units: priced.reduce((n, r) => n + r.qty, 0),
      market: priced.reduce((n, r) => n + r.marketValueCents, 0),
      sticker: priced.reduce((n, r) => n + r.qty * r.sticker, 0),
      cost: known.reduce((n, r) => n + r.knownCostCents, 0),
      unrealised: known.reduce((n, r) => n + r.marketValueCents - r.knownCostCents, 0),
      unknownCostItems: priced.filter((r) => r.costUnknown).length,
      stale: priced.filter((r) => r.stalePrice).length,
      oversold: scoped.filter((r) => r.oversold > 0).length,
      resticker: scoped.filter((r) => r.needsSticker).length,
    }
  }, [scoped])

  const movers = useMemo(
    () =>
      scoped
        .filter((r) => r.item.previousMarketPriceCents && r.item.previousMarketPriceCents > 0 && r.item.previousMarketPriceCents !== r.item.marketPriceCents)
        .map((r) => ({ r, pct: ((r.item.marketPriceCents - r.item.previousMarketPriceCents!) / r.item.previousMarketPriceCents!) * 100 }))
        .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
        .slice(0, 8),
    [scoped],
  )
  const low = useMemo(() => scoped.filter((r) => r.lowStock).slice(0, 8), [scoped])

  const log = useMemo(() => {
    const costOf = saleLineCosts(raw)
    const all = buildSalesLog({ sales: raw.sales, items: raw.items, showName: (id) => raw.shows.find((s) => s.id === id)?.name ?? '', costOf })
    return filterLog(all, { owner: view })
  }, [raw, view])

  const last30 = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(start.getTime() - (29 - i) * DAY)
      return { key: d.getTime(), label: `${d.getDate()}/${d.getMonth() + 1}`, dollars: 0 }
    })
    for (const r of log) {
      const d = new Date(r.soldAt)
      d.setHours(0, 0, 0, 0)
      const slot = days.find((x) => x.key === d.getTime())
      if (slot) slot.dollars += r.revenueCents / 100
    }
    return days
  }, [log])

  const totals = useMemo(() => totalsOf(log), [log])
  const title = view === 'all' ? 'Combined' : `${nameOf(view)}'s stock`

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
      <h1 className="mb-3 text-xl font-semibold">Dashboard · {title}</h1>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Market value" value={formatAud(stats.market)} sub={`${stats.items} items, ${stats.units} units`} />
        <Tile label="Sticker value" value={formatAud(stats.sticker)} />
        <Tile label="Known cost" value={formatAud(stats.cost)} sub={stats.unknownCostItems ? `${stats.unknownCostItems} items have no cost recorded` : undefined} />
        <Tile label="Unrealised profit" value={formatAud(stats.unrealised)} sub="Items with a recorded cost only" />
        <Tile label="Sales, all time" value={formatAud(totals.revenueCents)} sub={`${totals.count} lines · profit ${formatAud(totals.profitCents)}`} />
        <Tile label="Needs attention" value={String(stats.stale + stats.oversold + stats.resticker + low.length)} sub={`${stats.stale} stale · ${stats.resticker} re-sticker · ${low.length} low · ${stats.oversold} oversold`} />
      </div>

      <div className="mb-4 rounded-lg border border-line bg-surface p-3">
        <h2 className="mb-2 font-semibold">Sales, last 30 days</h2>
        {totals.count === 0 ? <p className="text-sm opacity-70">No sales yet.</p> : (
          <div className="h-48" role="img" aria-label="Daily sales for the last 30 days">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last30} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" interval={4} tick={{ fill: 'var(--ink)', fontSize: 11 }} stroke="var(--line)" />
                <YAxis tickFormatter={(v: number) => `$${v}`} width={52} tick={{ fill: 'var(--ink)', fontSize: 11 }} stroke="var(--line)" />
                <Tooltip formatter={(v) => [formatAud(Math.round(Number(v) * 100)), 'Sales']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }} cursor={{ fill: 'var(--hover)' }} />
                <Bar dataKey="dollars" fill="var(--brand)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-surface p-3" aria-label="Top movers">
          <h2 className="mb-2 font-semibold">Top movers</h2>
          {movers.length === 0 ? <p className="text-sm opacity-70">Prices haven't changed yet. Movers show up after you update a market price.</p> : (
            <ul className="text-sm">
              {movers.map(({ r, pct }) => (
                <li key={r.item.id} className="flex justify-between border-t border-line py-1 first:border-0">
                  <button className="truncate text-left underline" onClick={() => openItem(r.item.id)}>{r.item.name} {r.item.cardNumber}</button>
                  <span className={pct >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-500'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% · {formatAud(r.item.marketPriceCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface p-3" aria-label="Low stock">
          <h2 className="mb-2 font-semibold">Low stock</h2>
          {low.length === 0 ? <p className="text-sm opacity-70">Nothing is low. Set a "low stock" level on an item to track it.</p> : (
            <ul className="text-sm">
              {low.map((r) => (
                <li key={r.item.id} className="flex justify-between border-t border-line py-1 first:border-0">
                  <button className="truncate text-left underline" onClick={() => openItem(r.item.id)}>{r.item.name} {r.item.cardNumber}</button>
                  <span>{r.qty} left</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface p-3" aria-label="Recent sales">
          <h2 className="mb-2 font-semibold">Recent sales</h2>
          {log.length === 0 ? <p className="text-sm opacity-70">No sales yet.</p> : (
            <ul className="text-sm">
              {log.filter((r) => !r.voided).slice(0, 8).map((r, i) => (
                <li key={r.saleId + i} className="flex justify-between gap-2 border-t border-line py-1 first:border-0">
                  <span className="truncate">{r.itemName}<span className="block text-xs opacity-60">{fmtDateTime(r.soldAt)} · sold by {nameOf(r.soldBy)}</span></span>
                  <span>{formatAud(r.revenueCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
