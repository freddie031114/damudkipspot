import type { RawData } from './derive'
import type { DataSource } from './source'
import type { AuditEntry, PricePoint, WriteOp } from './types'

/** In-memory data source: same contract as Firestore, used for demos and UI tests. */
export function memorySource(initial?: Partial<RawData>): DataSource & { data: RawData; audit: AuditEntry[]; prices: PricePoint[] } {
  const data: RawData = { items: [], lots: [], sales: [], adjustments: [], shows: [], showExpenses: [], profiles: [], ...initial }
  const audit: AuditEntry[] = []
  const prices: PricePoint[] = []
  const listeners = new Set<(d: RawData) => void>()
  const lists: Record<string, Record<string, unknown>[]> = {
    ...(data as unknown as Record<string, Record<string, unknown>[]>),
    auditLog: audit as unknown as Record<string, unknown>[],
    priceHistory: prices as unknown as Record<string, unknown>[],
  }
  return {
    data,
    audit,
    prices,
    subscribe(onData) {
      const push = (d: RawData) => onData({ ...d }, { pending: false })
      listeners.add(push)
      push(data)
      return () => listeners.delete(push)
    },
    async commit(ops: WriteOp[]) {
      for (const op of ops) {
        const list = lists[op.collection]
        if (!list) continue
        const i = list.findIndex((x) => x.id === op.id)
        if (i >= 0) list[i] = op.merge ? { ...list[i], ...op.data } : op.data
        else list.push(op.data)
      }
      listeners.forEach((l) => l(data))
    },
    async itemHistory(itemId) {
      return {
        prices: prices.filter((p) => p.itemId === itemId).sort((a, b) => a.recordedAt - b.recordedAt),
        audit: audit.filter((a) => a.entityId === itemId).sort((a, b) => b.at - a.at),
      }
    },
    async recentAudit(limit) {
      return [...audit].sort((a, b) => b.at - a.at).slice(0, limit)
    },
  }
}
