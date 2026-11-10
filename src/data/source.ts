import type { RawData } from './derive'
import type { AuditEntry, PricePoint, WriteOp } from './types'

export interface SourceMeta {
  /** True while local changes have not yet been confirmed by the server. */
  pending: boolean
}

/** Where data comes from and goes to. Firestore in production, memory for demos and tests. */
export interface DataSource {
  subscribe(onData: (d: RawData, meta: SourceMeta) => void, onError: (e: Error) => void): () => void
  /** Resolves when the server has confirmed the write. Offline it stays pending, which is fine. */
  commit(ops: WriteOp[]): Promise<void>
  /** Price history and audit entries for one item (loaded on demand, not subscribed). */
  itemHistory(itemId: string): Promise<{ prices: PricePoint[]; audit: AuditEntry[] }>
  /** Most recent audit entries across everything (loaded on demand). */
  recentAudit(limit: number): Promise<AuditEntry[]>
}
