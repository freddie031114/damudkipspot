import { useMemo, useState } from 'react'
import { restoreItems } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import { formatAud } from '../domain/money'
import { btnCls, ghostBtn } from '../ui/common'
import { fmtDateTime, nameOf } from '../ui/format'

export function TrashPage() {
  const { raw, apply } = useStore()
  const ctx = useChangeCtx()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const deleted = useMemo(() => raw.items.filter((i) => i.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)), [raw.items])

  const restore = (ids: string[]) => {
    apply(restoreItems(ctx(), deleted.filter((i) => ids.includes(i.id))))
    setPicked(new Set())
  }

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-5 md:p-7">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <span className="text-sm opacity-70">Deleted items are kept here and can always be restored.</span>
        {picked.size > 0 && <button className={`${btnCls} ml-auto`} onClick={() => restore([...picked])}>Restore {picked.size} selected</button>}
      </div>
      {deleted.length === 0 ? <p className="opacity-70">Nothing in the trash.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase"><tr><th className="py-1" /><th>Item</th><th>Stock of</th><th className="text-right">Market</th><th>Deleted</th><th /></tr></thead>
          <tbody>
            {deleted.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-1.5"><input type="checkbox" aria-label={`Select ${i.name}`} checked={picked.has(i.id)} onChange={() => { const s = new Set(picked); if (s.has(i.id)) s.delete(i.id); else s.add(i.id); setPicked(s) }} /></td>
                <td>{i.name} <span className="opacity-60">{[i.setName, i.cardNumber].filter(Boolean).join(' · ')}</span></td>
                <td>{nameOf(i.profileId)}</td><td className="text-right">{formatAud(i.marketPriceCents)}</td>
                <td>{i.deletedAt ? fmtDateTime(i.deletedAt) : ''}</td>
                <td className="text-right"><button className={ghostBtn} onClick={() => restore([i.id])}>Restore</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
