import { useMemo, useState, type FormEvent } from 'react'
import { addLot, createItem } from '../data/changes'
import { matchesSearch } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import type { ItemKind, ProfileId } from '../data/types'
import { parseGrade } from '../domain/grade'
import { parseMoney } from '../domain/money'
import { btnCls, ghostBtn, inputCls, Modal } from './common'

const field = 'block text-xs font-medium'

export function QuickAdd({ owner, onClose }: { owner: ProfileId; onClose: () => void }) {
  const { rows, apply } = useStore()
  const ctx = useChangeCtx()
  const [f, setF] = useState({
    name: '', setName: '', cardNumber: '', language: 'EN', variant: '', condition: 'NM', kind: 'single' as ItemKind,
    qty: '1', cost: '', market: '', location: '',
  })
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  // Same card already in stock? Offer to add a lot instead of a duplicate row.
  const dupes = useMemo(() => {
    if (f.name.trim().length < 2) return []
    return rows
      .filter((r) => r.item.profileId === owner && matchesSearch(r.item, `${f.name} ${f.cardNumber}`))
      .slice(0, 4)
  }, [rows, f.name, f.cardNumber, owner])

  function parseQtyCost() {
    const qty = Number(f.qty)
    if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of at least 1')
    const cost = f.cost.trim() === '' ? null : parseMoney(f.cost)
    if (f.cost.trim() !== '' && cost === null) throw new Error('Cost is not a valid amount')
    return { qty, cost }
  }

  function save(e: FormEvent, again: boolean) {
    e.preventDefault()
    try {
      const { qty, cost } = parseQtyCost()
      const grade = parseGrade(f.condition)
      const market = f.market.trim() === '' ? 0 : parseMoney(f.market)
      if (market === null) throw new Error('Market price is not a valid amount')
      apply(
        createItem(ctx(), {
          profileId: owner, name: f.name, setName: f.setName, cardNumber: f.cardNumber, language: f.language,
          variant: f.variant, condition: f.kind === 'sealed' ? '' : f.condition.trim(), ...(grade ? { gradingCompany: grade.gradingCompany, grade: grade.grade } : {}), kind: grade && f.kind === 'single' ? 'graded' : f.kind, marketPriceCents: market, location: f.location,
        }, { qty, unitCostCents: cost }),
      )
      if (again) setF({ ...f, name: '', cardNumber: '', market: '', cost: '', qty: '1' })
      else onClose()
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function addToExisting(id: string) {
    try {
      const { qty, cost } = parseQtyCost()
      const row = rows.find((r) => r.item.id === id)!
      apply(addLot(ctx(), row.item, qty, cost))
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Add stock" onClose={onClose} wide>
      <form onSubmit={(e) => save(e, false)} className="grid grid-cols-6 gap-3">
        <label className={`${field} col-span-6`}>Name
          <input className={inputCls} value={f.name} onChange={set('name')} autoFocus placeholder="Charizard" />
        </label>
        <label className={`${field} col-span-3`}>Number<input className={inputCls} value={f.cardNumber} onChange={set('cardNumber')} placeholder="183/165" /></label>
        <label className={`${field} col-span-3`}>Condition
          <input className={inputCls} list="add-conditions" value={f.condition} onChange={set('condition')} placeholder="NM, LP, PSA 9…" />
          <datalist id="add-conditions">{['NM', 'LP', 'MP', 'HP', 'DMG', 'PSA 10', 'PSA 9', 'CGC 10', 'BGS 9.5'].map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className={`${field} col-span-2`}>Quantity<input className={inputCls} inputMode="numeric" value={f.qty} onChange={set('qty')} /></label>
        <label className={`${field} col-span-2`}>Cost each (optional)<input className={inputCls} inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="$" /></label>
        <label className={`${field} col-span-2`}>Market price<input className={inputCls} inputMode="decimal" value={f.market} onChange={set('market')} placeholder="$" /></label>

        <details className="col-span-6 rounded-xl border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">More details</summary>
          <div className="mt-3 grid grid-cols-6 gap-3">
            <label className={`${field} col-span-3`}>Type
              <select className={inputCls} value={f.kind} onChange={set('kind')}>
                <option value="single">Single</option><option value="graded">Graded slab</option>
                <option value="sealed">Sealed product</option><option value="other">Other</option>
              </select>
            </label>
            <label className={`${field} col-span-3`}>Location<input className={inputCls} value={f.location} onChange={set('location')} placeholder="Binder 1" /></label>
            <label className={`${field} col-span-3`}>Set<input className={inputCls} value={f.setName} onChange={set('setName')} /></label>
            <label className={`${field} col-span-1`}>Lang
              <select className={inputCls} value={f.language} onChange={set('language')}>
                {['EN', 'JA', 'zh-CN', 'zh-TW', 'KO', 'DE', 'FR'].map((l) => <option key={l}>{l}</option>)}
              </select>
            </label>
            <label className={`${field} col-span-2`}>Variant / finish<input className={inputCls} value={f.variant} onChange={set('variant')} placeholder="Holo, Reverse…" /></label>
          </div>
        </details>

        {dupes.length > 0 && (
          <div className="col-span-6 rounded border border-accent p-2 text-sm">
            <p className="mb-1 font-medium">Already in stock. Add to one of these instead?</p>
            {dupes.map((d) => (
              <div key={d.item.id} className="flex items-center justify-between py-0.5">
                <span>{d.item.name} {d.item.cardNumber} <span className="opacity-60">({d.qty} in stock)</span></span>
                <button type="button" className={ghostBtn} onClick={() => addToExisting(d.item.id)}>Add {f.qty || 1} here</button>
              </div>
            ))}
          </div>
        )}
        {error && <p role="alert" className="col-span-6 text-sm text-red-500">{error}</p>}
        <div className="col-span-6 flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={(e) => save(e, true)}>Save and add another</button>
          <button className={btnCls}>Save</button>
        </div>
      </form>
    </Modal>
  )
}
