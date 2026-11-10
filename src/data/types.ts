import type { PaymentMethod, ProfileId, SaleLine, SalePayment, SaleTradeIn } from '../domain/sale'

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
  /** Market price before the most recent change (for top movers). */
  previousMarketPriceCents: number | null
  stickerOverrideCents: number | null
  /** The price on the physical sticker; null if not stickered yet. Drives the re-sticker flag. */
  stickeredPriceCents: number | null
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
  /** The sale that brought this stock in (trade-ins only). */
  saleId?: string | null
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
  /** Cards received from the customer in this sale; each created a stock lot costed at the credit given. */
  tradeIns?: SaleTradeIn[]
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
  | 'importBatches' | 'shows' | 'showExpenses' | 'savedViews' | 'profiles'

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
  previousMarketPriceCents: null as number | null,
  stickerOverrideCents: null as number | null,
  stickeredPriceCents: null as number | null,
  notes: '',
  tags: [] as string[],
  lowStockThreshold: null as number | null,
  importBatchId: null as string | null,
}
export type NewItem = Omit<typeof NEW_ITEM_DEFAULTS, never> & { profileId: ProfileId }

export interface Participant {
  profileId: ProfileId
  openingFloatCents: number
  /** Cash counted at the end of the show; null until counted. */
  closingCashCents: number | null
}

export interface Show extends Base {
  name: string
  startsOn: string
  endsOn: string
  venue: string
  tableFeeCents: number
  status: 'planned' | 'live' | 'closed'
  notes: string
  participants: Participant[]
  /** The expense that records the table fee (kept in step with tableFeeCents). */
  feeExpenseId: string | null
  deletedAt: number | null
}

export interface ShowExpense extends Base {
  showId: string
  description: string
  amountCents: number
  paidByProfileId: ProfileId
  /** Share of the expense each person bears, as whole percentages adding to 100. */
  splitPct: Record<ProfileId, number>
  deletedAt: number | null
}

export interface ProfileDoc {
  id: ProfileId
  settings?: Partial<import('./derive').Settings>
}

export interface PricePoint {
  id: string
  itemId: string
  marketPriceCents: number
  recordedAt: number
  recordedBy: ProfileId
  source: string
}

export interface AuditEntry {
  id: string
  at: number
  actorProfileId: ProfileId
  targetProfileId: ProfileId
  entity: string
  entityId: string
  action: string
  diff: unknown
}
