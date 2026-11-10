import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { addLot, deleteItems, deleteLot, updateItem, updateLot, type ItemEdit } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import type { AuditEntry, PricePoint } from '../data/types'
import { formatAud, parseMoney } from '../domain/money'
import { allocateFifo } from '../domain/fifo'
import { supplyAndDemand } from '../data/derive'
import { btnCls, ghostBtn, inputCls } from './common'
import { fmtDate, fmtDateTime, nameOf } from './format'

const lbl = 'block text-xs font-medium'

function Text({ label, value, onCommit, disabled, className = '' }: { label: string; value: string; onCommit: (v: string) => void; disabled?: boolean; className?: string }) {
  return (
    <label className={`${lbl} ${className}`}>{label}
      <input className={inputCls} defaultValue={value} disabled={disabled} onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
    </label>
  )
}

export function ItemDrawer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { raw, rows, apply, notify, source } = useStore()
  const ctx = useChangeCtx()
  const row = rows.find((r) => r.item.id === itemId)
  const item = row?.item ?? raw.items.find((i) => i.id === itemId)
  const [hist, setHist] = useState<{ prices: PricePoint[]; audit: AuditEntry[] } | null>(null)
  const [newQty, setNewQty] = useState('1')
  const [newCost, setNewCost] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const stamp = item?.updatedAt
  useEffect(() => {
    let live = true
    source.itemHistory(itemId).then((h) => live && setHist(h)).catch(() => live && setHist({ prices: [], audit: [] }))
    return () => { live = false }
  }, [source, itemId, stamp])

  const lots = useMemo(() => raw.lots.filter((l) => l.itemId === itemId && !l.deletedAt).sort((a, b) => a.acquiredAt - b.acquiredAt), [raw.lots, itemId])
  const remaining = useMemo(() => {
    const { supplies, demands } = supplyAndDemand(raw)
    return allocateFifo(supplies, demands).remainingBySupply
  }, [raw])
  const sales = useMemo(
    () => raw.sales.flatMap((s) => s.lines.filter((l) => l.itemId === itemId).map((l) => ({ s, l }))).sort((a, b) => b.s.soldAt - a.s.soldAt),
    [raw.sales, itemId],
  )

  if (!item) return null
  const edit = (e: ItemEdit) => {
    try { apply(updateItem(ctx(), item, e)) } catch (err) { notify((err as Error).message, true) }
  }
  const chart = (hist?.prices ?? []).map((p) => ({ at: p.recordedAt, dollars: p.marketPriceCents / 100 }))

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside role="dialog" aria-label={`Details for ${item.name}`} className="h-full w-full max-w-xl overflow-y-auto bg-surface p-5 shadow-xl" key={item.id}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{item.name}</h2>
            <p className="text-sm opacity-70">{nameOf(item.profileId)}'s stock{item.deletedAt ? ' · deleted' : ''} · {row?.qty ?? 0} on hand</p>
          </div>
          <button aria-label="Close details" className="px-2 text-2xl leading-none" onClick={onClose}>×</button>
        </div>

        <section className="mb-5 grid grid-cols-6 gap-3" key={item.updatedAt} aria-label="Details">
          <Text className="col-span-4" label="Name" value={item.name} onCommit={(v) => edit({ name: v })} />
          <label className={`${lbl} col-span-2`}>Type
            <select className={inputCls} value={item.kind} onChange={(e) => edit({ kind: e.target.value as typeof item.kind })}>
              <option value="single">Single</option><option value="graded">Graded slab</option><option value="sealed">Sealed product</option><option value="bulk">Bulk</option><option value="other">Other</option>
            </select>
          </label>
          <Text className="col-span-3" label="Set" value={item.setName} onCommit={(v) => edit({ setName: v.trim() })} />
          <Text className="col-span-2" label="Number" value={item.cardNumber} onCommit={(v) => edit({ cardNumber: v.trim() })} />
          <Text className="col-span-1" label="Lang" value={item.language} onCommit={(v) => edit({ language: v.trim() })} />
          <Text className="col-span-2" label="Variant / finish" value={item.variant} onCommit={(v) => edit({ variant: v.trim() })} />
          <Text className="col-span-1" label="Cond." value={item.condition} onCommit={(v) => edit({ condition: v.trim() })} />
          <Text className="col-span-1" label="Grader" value={item.gradingCompany} onCommit={(v) => edit({ gradingCompany: v.trim().toUpperCase() })} />
          <Text className="col-span-1" label="Grade" value={item.grade} onCommit={(v) => edit({ grade: v.trim() })} />
          <Text className="col-span-3" label="Game" value={item.game} onCommit={(v) => edit({ game: v.trim() })} />
          <Text className="col-span-3" label="Location" value={item.location} onCommit={(v) => edit({ location: v.trim() })} />
          <label className={`${lbl} col-span-2`}>Market price
            <input className={inputCls} inputMode="decimal" defaultValue={(item.marketPriceCents / 100).toFixed(2)}
              onBlur={(e) => { const c = parseMoney(e.target.value); if (c === null || c < 0) { notify('Enter a valid price', true); e.target.value = (item.marketPriceCents / 100).toFixed(2) } else edit({ marketPriceCents: c }) }} />
          </label>
          <label className={`${lbl} col-span-2`}>Sticker (blank = market × multiplier)
            <input className={inputCls} inputMode="decimal" placeholder={row ? (row.sticker / 100).toFixed(2) : ''} defaultValue={item.stickerOverrideCents === null ? '' : (item.stickerOverrideCents / 100).toFixed(2)}
              onBlur={(e) => { const v = e.target.value.trim(); if (v === '') edit({ stickerOverrideCents: null }); else { const c = parseMoney(v); if (c === null || c < 0) notify('Enter a valid sticker price', true); else edit({ stickerOverrideCents: c }) } }} />
          </label>
          <label className={`${lbl} col-span-2`}>On the sticker now
            <input className={inputCls} inputMode="decimal" placeholder="not stickered" defaultValue={item.stickeredPriceCents === null ? '' : (item.stickeredPriceCents / 100).toFixed(2)}
              onBlur={(e) => { const v = e.target.value.trim(); if (v === '') edit({ stickeredPriceCents: null }); else { const c = parseMoney(v); if (c === null || c < 0) notify('Enter a valid price', true); else edit({ stickeredPriceCents: c }) } }} />
          </label>
          <label className={`${lbl} col-span-2`}>Low stock at or below
            <input className={inputCls} inputMode="numeric" defaultValue={item.lowStockThreshold ?? ''} placeholder="off"
              onBlur={(e) => { const v = e.target.value.trim(); if (v === '') edit({ lowStockThreshold: null }); else { const n = Number(v); if (Number.isInteger(n) && n >= 0) edit({ lowStockThreshold: n }); else notify('Use a whole number, or blank to turn off', true) } }} />
          </label>
          <label className={`${lbl} col-span-6`}>Notes
            <textarea className={`${inputCls} h-16`} defaultValue={item.notes} onBlur={(e) => { if (e.target.value !== item.notes) edit({ notes: e.target.value }) }} />
          </label>
        </section>

        <section className="mb-5" aria-label="Stock lots">
          <h3 className="mb-1 font-semibold">Stock lots</h3>
          <p className="mb-2 text-xs opacity-70">Each purchase is a lot. Sales use the oldest lot first. Add a cost to a lot with none and profit on past sales updates.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase"><tr><th className="py-1">Added</th><th>Bought</th><th>Left</th><th>Cost each</th><th /></tr></thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="py-1">{fmtDate(l.acquiredAt)}<div className="text-xs opacity-60">{l.source}</div></td>
                  <td>{l.qty}</td><td>{remaining.get(l.id) ?? 0}</td>
                  <td>
                    <input className="w-24 rounded border border-line bg-transparent px-1" aria-label="Lot cost each" placeholder="unknown" inputMode="decimal"
                      defaultValue={l.unitCostCents === null ? '' : (l.unitCostCents / 100).toFixed(2)}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        const c = v === '' ? null : parseMoney(v)
                        if (v !== '' && c === null) return notify('Enter a valid cost', true)
                        try { apply(updateLot(ctx(), l, { unitCostCents: c }, item.name)) } catch (err) { notify((err as Error).message, true) }
                      }} />
                  </td>
                  <td className="text-right"><button className="text-xs underline" onClick={() => apply(deleteLot(ctx(), l, item.name))}>Remove</button></td>
                </tr>
              ))}
              {lots.length === 0 && <tr><td colSpan={5} className="py-2 opacity-60">No stock lots.</td></tr>}
            </tbody>
          </table>
          <form className="mt-2 flex items-end gap-2" onSubmit={(e) => {
            e.preventDefault()
            const qty = Number(newQty)
            const cost = newCost.trim() === '' ? null : parseMoney(newCost)
            if (newCost.trim() !== '' && cost === null) return notify('Enter a valid cost', true)
            try { apply(addLot(ctx(), item, qty, cost)); setNewCost(''); setNewQty('1') } catch (err) { notify((err as Error).message, true) }
          }}>
            <label className={lbl}>Add stock<input className={`${inputCls} w-20`} inputMode="numeric" aria-label="New lot quantity" value={newQty} onChange={(e) => setNewQty(e.target.value)} /></label>
            <label className={lbl}>Cost each<input className={`${inputCls} w-28`} inputMode="decimal" aria-label="New lot cost" placeholder="optional" value={newCost} onChange={(e) => setNewCost(e.target.value)} /></label>
            <button className={btnCls}>Add lot</button>
          </form>
        </section>

        <section className="mb-5" aria-label="Price history">
          <h3 className="mb-1 font-semibold">Market price history</h3>
          {chart.length < 2 ? (
            <p className="text-sm opacity-70">{chart.length === 1 ? `Only one price so far (${formatAud(item.marketPriceCents)}). The chart appears after the price changes.` : 'No price history yet.'}</p>
          ) : (
            <div className="h-44" role="img" aria-label={`Price history chart, ${chart.length} points`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                  <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => fmtDate(v)} tick={{ fill: 'var(--ink)', fontSize: 11 }} stroke="var(--line)" />
                  <YAxis tickFormatter={(v: number) => `$${v}`} width={52} tick={{ fill: 'var(--ink)', fontSize: 11 }} stroke="var(--line)" domain={['auto', 'auto']} />
                  <Tooltip labelFormatter={(v) => fmtDateTime(Number(v))} formatter={(v) => [formatAud(Math.round(Number(v) * 100)), 'Market']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
                  <Line type="stepAfter" dataKey="dollars" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3, fill: 'var(--brand)' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="mb-5" aria-label="Sales of this item">
          <h3 className="mb-1 font-semibold">Sales</h3>
          {sales.length === 0 ? <p className="text-sm opacity-70">Not sold yet.</p> : (
            <ul className="text-sm">
              {sales.slice(0, 20).map(({ s, l }) => (
                <li key={s.id + l.unitPriceCents} className={`flex justify-between border-t border-line py-1 ${s.voidedAt ? 'line-through opacity-50' : ''}`}>
                  <span>{fmtDateTime(s.soldAt)} · {nameOf(s.soldByProfileId)}</span><span>{l.qty} × {formatAud(l.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-5" aria-label="History">
          <h3 className="mb-1 font-semibold">Change history</h3>
          {!hist ? <p className="text-sm opacity-70">Loading…</p> : hist.audit.length === 0 ? <p className="text-sm opacity-70">Nothing recorded.</p> : (
            <ul className="max-h-48 overflow-y-auto text-sm">
              {hist.audit.map((a) => (
                <li key={a.id} className="border-t border-line py-1"><span className="opacity-70">{fmtDateTime(a.at)}</span> · {nameOf(a.actorProfileId)} · {a.action}</li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex justify-between border-t border-line pt-3">
          <button className={ghostBtn} onClick={() => { apply(deleteItems(ctx(), [item])); onClose() }} disabled={!!item.deletedAt}>Delete item</button>
          <button className={btnCls} onClick={onClose}>Done</button>
        </div>
      </aside>
    </div>
  )
}
