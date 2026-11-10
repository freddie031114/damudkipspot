import { useMemo, useState } from 'react'
import { matchesSearch, type InventoryRow } from '../data/derive'
import { useStore } from '../data/store'
import { formatAud } from '../domain/money'
import { parseTradeEntry, tradeBalanceCents, type TradeInDraft } from '../domain/trade'
import { DEFAULT_NAMES, PROFILE_IDS } from '../lib/profile'
import type { ProfileId } from '../data/types'
import { ghostBtn } from './common'

const small = 'w-full rounded-lg border border-line bg-transparent px-2 py-1 text-sm'
const blank = { name: '', cardNumber: '', condition: '', qty: '1', credit: '', market: '' }

/**
 * The cards a customer hands over in a trade. Each one becomes stock costed at the credit given,
 * and the credit counts as payment towards the sale. `saleTotalCents` is only used to show what
 * is left to pay (or the cash to hand back).
 */
export function TradeInEditor({ value, onChange, owner, onOwner, saleTotalCents }: {
  value: TradeInDraft[]
  onChange: (v: TradeInDraft[]) => void
  /** Whose stock new cards go into. Cards matched to an existing item join that item's owner. */
  owner: ProfileId
  onOwner: (p: ProfileId) => void
  saleTotalCents: number
}) {
  const { rows, notify } = useStore()
  const [f, setF] = useState(blank)
  const [picked, setPicked] = useState<InventoryRow | null>(null)
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value })
    if (k === 'name') setPicked(null)
  }

  const matches = useMemo(() => {
    if (picked || f.name.trim().length < 2) return []
    return rows.filter((r) => r.item.kind !== 'bulk' && matchesSearch(r.item, `${f.name} ${f.cardNumber}`)).slice(0, 4)
  }, [rows, f.name, f.cardNumber, picked])

  function pick(r: InventoryRow) {
    setPicked(r)
    setF({ ...f, name: r.item.name, cardNumber: r.item.cardNumber, condition: r.item.condition, credit: f.credit || (r.item.marketPriceCents / 100).toFixed(2) })
  }

  function add() {
    try {
      const d = parseTradeEntry(f, picked ? picked.item.profileId : owner, crypto.randomUUID(), picked ? { itemId: picked.item.id } : undefined)
      onChange([...value, d])
      setF(blank)
      setPicked(null)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  const credit = value.reduce((n, d) => n + d.qty * d.creditCents, 0)
  const balance = tradeBalanceCents(saleTotalCents, value)
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add() }
  }

  return (
    <div className="space-y-2 text-sm" aria-label="Trade-in">
      {value.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {value.map((d) => (
            <li key={d.key} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="min-w-0 truncate">
                {d.qty} × {d.name} <span className="opacity-60">{[d.cardNumber, d.condition].filter(Boolean).join(' · ')}</span>
                {d.itemId === null && <span className="ml-1 rounded bg-chip px-1 text-[10px] text-ink">new</span>}
                {d.ownerProfileId !== owner && <span className="ml-1 text-xs opacity-60">→ {DEFAULT_NAMES[d.ownerProfileId]}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {formatAud(d.qty * d.creditCents)}
                <button type="button" aria-label={`Remove ${d.name} from trade`} onClick={() => onChange(value.filter((x) => x.key !== d.key))}>×</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-12 gap-1.5" onKeyDown={onEnter}>
        <input className={`${small} col-span-8`} aria-label="Trade-in card name" placeholder="Card they are giving you" value={f.name} onChange={set('name')} />
        <input className={`${small} col-span-4`} aria-label="Trade-in card number" placeholder="Number" value={f.cardNumber} onChange={set('cardNumber')} readOnly={!!picked} />
        {matches.length > 0 && (
          <ul className="col-span-12 rounded-lg border border-accent" role="listbox" aria-label="Already in stock">
            <li className="px-2 pt-1 text-[11px] uppercase tracking-wider opacity-60">Already in stock: add to it instead of a new row</li>
            {matches.map((r) => (
              <li key={r.item.id} role="option" aria-selected={false} className="flex cursor-pointer justify-between px-2 py-1 hover:bg-hover" onClick={() => pick(r)}>
                <span>{r.item.name} <span className="opacity-60">{r.item.cardNumber} {r.item.condition}</span>
                  <span className="ml-1 text-xs opacity-60">{DEFAULT_NAMES[r.item.profileId]}</span></span>
                <span className="opacity-70">{r.qty} in stock</span>
              </li>
            ))}
          </ul>
        )}
        <input className={`${small} col-span-4`} aria-label="Trade-in condition" placeholder="NM, PSA 9…" value={f.condition} onChange={set('condition')} readOnly={!!picked} />
        <input className={`${small} col-span-2`} aria-label="Trade-in quantity" inputMode="numeric" placeholder="Qty" value={f.qty} onChange={set('qty')} />
        <input className={`${small} col-span-3`} aria-label="Credit each" inputMode="decimal" placeholder="Credit $" value={f.credit} onChange={set('credit')} />
        <input className={`${small} col-span-3`} aria-label="Market price each" inputMode="decimal" placeholder="Mkt $" title="Market price each. Leave blank to use the credit." value={f.market} onChange={set('market')} disabled={!!picked} />
        <button type="button" className={`${ghostBtn} col-span-12 !py-1`} onClick={add}>Add card to trade</button>
      </div>

      <label className="flex items-center justify-between text-xs">New cards go into
        <select aria-label="Trade-in stock goes to" className="rounded border border-line bg-transparent px-1 py-0.5 text-sm" value={owner} onChange={(e) => onOwner(e.target.value as ProfileId)}>
          {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}'s stock</option>)}
        </select>
      </label>

      {value.length > 0 && (
        <div className="space-y-0.5 rounded-lg bg-hover/60 px-2 py-1.5" aria-label="Trade summary">
          <div className="flex justify-between"><span>Trade credit</span><strong>{formatAud(credit)}</strong></div>
          <div className="flex justify-between">
            <span>{balance < 0 ? 'Hand back to customer' : 'Customer still pays'}</span>
            <strong>{formatAud(Math.abs(balance))}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
