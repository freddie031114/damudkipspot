import type { RawData } from './derive'
import type { DataSource } from './source'
import type { WriteOp } from './types'

/** In-memory data source: same contract as Firestore, used for demos and UI tests. */
export function memorySource(initial?: Partial<RawData>): DataSource & { data: RawData } {
  const data: RawData = { items: [], lots: [], sales: [], adjustments: [], ...initial }
  const listeners = new Set<(d: RawData) => void>()
  const lists: Record<string, Record<string, unknown>[]> = data as unknown as Record<string, Record<string, unknown>[]>
  return {
    data,
    subscribe(onData) {
      const push = (d: RawData) => onData({ ...d }, { pending: false })
      listeners.add(push)
      push(data)
      return () => listeners.delete(push)
    },
    async commit(ops: WriteOp[]) {
      for (const op of ops) {
        const list = lists[op.collection]
        if (!list) continue // priceHistory / auditLog are not held in memory
        const i = list.findIndex((x) => x.id === op.id)
        if (i >= 0) list[i] = op.merge ? { ...list[i], ...op.data } : op.data
        else list.push(op.data)
      }
      listeners.forEach((l) => l(data))
    },
  }
}
