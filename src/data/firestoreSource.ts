import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where, writeBatch, type Firestore } from 'firebase/firestore'
import type { RawData } from './derive'
import { chunkOps } from './chunk'
import type { DataSource } from './source'
import type { AuditEntry, PricePoint } from './types'

const BATCH_LIMIT = 400 // Firestore allows 500 writes per batch; leave headroom.

const NAMES = ['items', 'lots', 'sales', 'adjustments', 'shows', 'showExpenses', 'profiles'] as const

export function firestoreSource(db: Firestore): DataSource {
  return {
    subscribe(onData, onError) {
      const data: RawData = { items: [], lots: [], sales: [], adjustments: [], shows: [], showExpenses: [], profiles: [] }
      const pending: Record<string, boolean> = {}
      const ready: Record<string, boolean> = {}
      const emit = () => {
        if (!NAMES.every((n) => ready[n])) return
        onData({ ...data }, { pending: Object.values(pending).some(Boolean) })
      }
      const unsubs = NAMES.map((name) =>
        onSnapshot(
          collection(db, name),
          (snap) => {
            ;(data as unknown as Record<string, unknown[]>)[name] = snap.docs.map((d) => d.data())
            pending[name] = snap.metadata.hasPendingWrites
            ready[name] = true
            emit()
          },
          onError,
        ),
      )
      return () => unsubs.forEach((u) => u())
    },

    async commit(ops) {
      const batches: Promise<void>[] = []
      for (const group of chunkOps(ops, BATCH_LIMIT)) {
        const batch = writeBatch(db)
        for (const op of group) batch.set(doc(db, op.collection, op.id), op.data, { merge: op.merge })
        batches.push(batch.commit())
      }
      await Promise.all(batches)
    },

    // Single-field queries only, so no composite index is needed; sorted on the client.
    async itemHistory(itemId) {
      const [p, a] = await Promise.all([
        getDocs(query(collection(db, 'priceHistory'), where('itemId', '==', itemId), limit(300))),
        getDocs(query(collection(db, 'auditLog'), where('entityId', '==', itemId), limit(300))),
      ])
      return {
        prices: p.docs.map((d) => d.data() as PricePoint).sort((x, y) => x.recordedAt - y.recordedAt),
        audit: a.docs.map((d) => d.data() as AuditEntry).sort((x, y) => y.at - x.at),
      }
    },

    async recentAudit(n) {
      const s = await getDocs(query(collection(db, 'auditLog'), orderBy('at', 'desc'), limit(n)))
      return s.docs.map((d) => d.data() as AuditEntry)
    },
  }
}
