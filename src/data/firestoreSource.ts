import { collection, doc, onSnapshot, writeBatch, type Firestore } from 'firebase/firestore'
import type { RawData } from './derive'
import type { DataSource } from './source'
import type { Adjustment, Item, Lot, Sale } from './types'

const BATCH_LIMIT = 400 // Firestore allows 500 writes per batch; leave headroom.

export function firestoreSource(db: Firestore): DataSource {
  return {
    subscribe(onData, onError) {
      const data: RawData = { items: [], lots: [], sales: [], adjustments: [] }
      const pending = { items: false, lots: false, sales: false, adjustments: false }
      const ready = { items: false, lots: false, sales: false, adjustments: false }
      const emit = () => {
        if (!Object.values(ready).every(Boolean)) return
        onData({ ...data }, { pending: Object.values(pending).some(Boolean) })
      }
      const listen = <K extends keyof RawData>(name: K) =>
        onSnapshot(
          collection(db, name),
          (snap) => {
            data[name] = snap.docs.map((d) => d.data()) as unknown as RawData[K]
            pending[name] = snap.metadata.hasPendingWrites
            ready[name] = true
            emit()
          },
          onError,
        )
      const unsubs = [listen('items'), listen('lots'), listen('sales'), listen('adjustments')]
      return () => unsubs.forEach((u) => u())
    },

    async commit(ops) {
      const batches: Promise<void>[] = []
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db)
        for (const op of ops.slice(i, i + BATCH_LIMIT)) {
          batch.set(doc(db, op.collection, op.id), op.data, { merge: op.merge })
        }
        batches.push(batch.commit())
      }
      await Promise.all(batches)
    },
  }
}

export type { Item, Lot, Sale, Adjustment }
