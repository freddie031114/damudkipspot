import type { PaymentMethod, ProfileId, SaleLine, SalePayment } from '../domain/sale'

export type { ProfileId }
export type ItemKind = 'single' | 'sealed' | 'graded' | 'bulk' | 'other'

interface Base {
  id: string
  createdAt: number
  updatedAt: number
  createdBy: ProfileId
  updatedBy: ProfileId
}

export interface Item extends Base {
  profileId: ProfileId
  kind: ItemKind
  game: string
  name: string
  setName: string
  setCode: string
  cardNumber: string
  language: string
  variant: string
  condition: string
  gradingCompany: string
  grade: string
  sealedType: string
  marketPriceCents: number
  marketPriceUpdatedAt: number
  stickerOverrideCents: number | null
  location: string
  notes: string
  tags: string[]
  lowStockThreshold: number | null
  importBatchId: string | null
  deletedAt: number | null
}

export interface Lot extends Base {
  itemId: string
  profileId: ProfileId
  acquiredAt: number
  qty: number
  unitCostCents: number | null
  source: 'purchase' | 'trade-in' | 'import' | 'opening'
  note: string
  importBatchId: string | null
  deletedAt: number | null
}

export interface Sale extends Base {
  soldByProfileId: ProfileId
  showId: string | null
  soldAt: number
  note: string
  discountCents: number
  lines: SaleLine[]
  payments: SalePayment[]
  voidedAt: number | null
  voidedBy: ProfileId | null
}

export interface Adjustment extends Base {
  itemId: string
  profileId: ProfileId
  qtyDelta: number
  reason: 'damaged' | 'lost' | 'kept' | 'count correction' | 'found'
  note: string
}

export type { PaymentMethod }

export type Collection =
  | 'items' | 'lots' | 'sales' | 'adjustments' | 'priceHistory' | 'auditLog'
  | 'importBatches' | 'shows' | 'showExpenses' | 'savedViews'

export interface WriteOp {
  collection: Collection
  id: string
  data: Record<string, unknown>
  /** true = merge into an existing doc; false = create/replace. */
  merge: boolean
  /** Ops sharing an atom are never split across Firestore batches (e.g. an item and its first lot). */
  atom?: string
}

export const NEW_ITEM_DEFAULTS = {
  kind: 'single' as ItemKind,
  game: 'Pokémon',
  name: '',
  setName: '',
  setCode: '',
  cardNumber: '',
  language: 'EN',
  variant: '',
  condition: '',
  gradingCompany: '',
  grade: '',
  sealedType: '',
  marketPriceCents: 0,
  stickerOverrideCents: null as number | null,
  location: '',
  notes: '',
  tags: [] as string[],
  lowStockThreshold: null as number | null,
  importBatchId: null as string | null,
}
export type NewItem = Omit<typeof NEW_ITEM_DEFAULTS, never> & { profileId: ProfileId }
