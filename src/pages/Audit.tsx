import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../data/store'
import type { AuditEntry, ProfileId } from '../data/types'
import { DEFAULT_NAMES, PROFILE_IDS } from '../lib/profile'
import { ghostBtn } from '../ui/common'
import { fmtDateTime, nameOf } from '../ui/format'

const LIMIT = 200

function summarise(a: AuditEntry): string {
  const d = a.diff as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return ''
  const parts = Object.entries(d).slice(0, 4).map(([k, v]) => {
    if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
      const x = v as { from: unknown; to: unknown }
      return `${k}: ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)}`
    }
    return `${k}: ${JSON.stringify(v)}`
  })
  return parts.join(' · ')
}

export function AuditPage() {
  const { source, raw } = useStore()
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  const [actor, setActor] = useState<ProfileId | 'all'>('all')
  const [entity, setEntity] = useState('all')

  const load = useCallback(() => {
    setError('')
    source.recentAudit(LIMIT).then(setEntries).catch((e: Error) => { setError(e.message); setEntries([]) })
  }, [source])
  useEffect(load, [load])

  const names = useMemo(() => new Map(raw.items.map((i) => [i.id, i.name])), [raw.items])
  const shown = (entries ?? []).filter((e) => (actor === 'all' || e.actorProfileId === actor) && (entity === 'all' || e.entity === entity))

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <span className="text-sm opacity-70">The latest {LIMIT} changes: who did what, and what it was before.</span>
        <label className="ml-auto text-sm">Who{' '}
          <select className="rounded border border-line bg-transparent px-1 py-0.5" value={actor} onChange={(e) => setActor(e.target.value as ProfileId | 'all')}><option value="all">Anyone</option>{PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}</select></label>
        <label className="text-sm">What{' '}
          <select className="rounded border border-line bg-transparent px-1 py-0.5" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="all">Everything</option>{['item', 'lot', 'sale', 'adjustment', 'show', 'expense', 'import', 'settings'].map((x) => <option key={x}>{x}</option>)}
          </select></label>
        <button className={ghostBtn} onClick={load}>Refresh</button>
      </div>
      {error && <p role="alert" className="mb-2 text-sm text-red-500">Could not load: {error}</p>}
      {entries === null ? <p>Loading…</p> : shown.length === 0 ? <p className="opacity-70">No matching changes.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase"><tr><th className="py-1">When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="py-1 whitespace-nowrap">{fmtDateTime(e.at)}</td><td>{nameOf(e.actorProfileId)}</td>
                <td>{e.action} {e.entity}{e.entity === 'item' && names.get(e.entityId) ? <span className="opacity-70"> · {names.get(e.entityId)}</span> : null}{e.targetProfileId !== e.actorProfileId && <span className="opacity-70"> ({nameOf(e.targetProfileId)}'s)</span>}</td>
                <td className="max-w-xl break-words text-xs opacity-80">{summarise(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
