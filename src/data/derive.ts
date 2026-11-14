import { allocateFifo, type Demand, type Supply } from '../domain/fifo'
import type { LineCost } from '../domain/show'
import { effectiveSticker, type StickerRounding } from '../domain/sticker'
import type { Adjustment, Item, Lot, ProfileDoc, ProfileId, Sale, Show, ShowExpense } from './types'

export interface Settings {
  multiplierPermille: number
  rounding: StickerRounding
  /** Market prices older than this many days are flagged stale. */
  stalePriceDays: number
  /** Physical sticker vs current sticker difference (%) that triggers "needs re-sticker". */
  restickerPct: number
}

export const DEFAULT_SETTINGS: Settings = { multiplierPermille: 1100, rounding: '1', stalePriceDays: 30, restickerPct: 10 }

export interface InventoryRow {
  item: Item
  qty: number
  sticker: number
  /** Market value of stock on hand. */
  marketValueCents: number
  /** Known cost of stock on hand. */
  knownCostCents: number
  /** True when some stock on hand has no recorded cost. */
  costUnknown: boolean
  oversold: number
  lowStock: boolean
  stalePrice: boolean
  /** The physical sticker is off from the current sticker price by more than the threshold. */
  needsSticker: boolean
}

export interface InventoryData {
  items: Item[]
  lots: Lot[]
  sales: Sale[]
  adjustments: Adjustment[]
}

export interface RawData extends InventoryData {
  shows: Show[]
  showExpenses: ShowExpense[]
  profiles: ProfileDoc[]
}

export type SettingsFor = (p: ProfileId) => Settings

/** Settings for a profile: saved values over the defaults. */
export function settingsFor(profiles: ProfileDoc[] | undefined, p: ProfileId): Settings {
  return { ...DEFAULT_SETTINGS, ...(profiles?.find((x) => x.id === p)?.settings ?? {}) }
}

const DAY = 86_400_000

/** Builds FIFO supply/demand from raw records. Soft-deleted lots and voided sales are ignored. */
export function supplyAndDemand(d: InventoryData): { supplies: Supply[]; demands: Demand[]; saleLineDemandIds: Map<string, string[]> } {
  const supplies: Supply[] = []
  const demands: Demand[] = []
  const saleLineDemandIds = new Map<string, string[]>()
  for (const l of d.lots) {
    if (l.deletedAt) continue
    supplies.push({ id: l.id, itemId: l.itemId, at: l.acquiredAt, seq: l.createdAt, qty: l.qty, unitCostCents: l.unitCostCents })
  }
  for (const a of d.adjustments) {
    if (a.qtyDelta > 0) supplies.push({ id: a.id, itemId: a.itemId, at: a.createdAt, seq: a.createdAt, qty: a.qtyDelta, unitCostCents: null })
    else demands.push({ id: a.id, itemId: a.itemId, at: a.createdAt, seq: a.createdAt, qty: -a.qtyDelta })
  }
  for (const s of d.sales) {
    if (s.voidedAt) continue
    const ids: string[] = []
    s.lines.forEach((l, i) => {
      const id = `${s.id}:${i}`
      ids.push(id)
      demands.push({ id, itemId: l.itemId, at: s.soldAt, seq: s.createdAt, qty: l.qty })
    })
    saleLineDemandIds.set(s.id, ids)
  }
  return { supplies, demands, saleLineDemandIds }
}

export function buildInventory(d: InventoryData, settings: Settings | SettingsFor = DEFAULT_SETTINGS, now = Date.now()): InventoryRow[] {
  const forProfile: SettingsFor = typeof settings === 'function' ? settings : () => settings
  const { supplies, demands } = supplyAndDemand(d)
  const fifo = allocateFifo(supplies, demands)
  const stockByItem = new Map<string, Supply[]>()
  for (const s of supplies) (stockByItem.get(s.itemId) ?? stockByItem.set(s.itemId, []).get(s.itemId)!).push(s)

  return d.items
    .filter((i) => !i.deletedAt)
    .map((item) => {
      const qty = fifo.onHandByItem.get(item.id) ?? 0
      // Bulk is a lump-sum value, not something with a sticker: it counts at market.
      const settings = forProfile(item.profileId)
      const sticker = item.kind === 'bulk' ? item.marketPriceCents : effectiveSticker(item, settings.multiplierPermille, settings.rounding)
      const costUnknown = (stockByItem.get(item.id) ?? []).some(
        (s) => s.unitCostCents === null && (fifo.remainingBySupply.get(s.id) ?? 0) > 0,
      )
      return {
        item,
        qty,
        sticker,
        marketValueCents: qty * item.marketPriceCents,
        knownCostCents: fifo.remainingKnownCostByItem.get(item.id) ?? 0,
        costUnknown,
        oversold: fifo.oversoldByItem.get(item.id) ?? 0,
        lowStock: item.lowStockThreshold !== null && qty <= item.lowStockThreshold,
        stalePrice: item.kind !== 'bulk' && now - item.marketPriceUpdatedAt > settings.stalePriceDays * DAY,
        needsSticker:
          item.kind !== 'bulk' && item.stickeredPriceCents !== null && item.stickeredPriceCents > 0 &&
          (Math.abs(sticker - item.stickeredPriceCents) / item.stickeredPriceCents) * 100 > settings.restickerPct,
      }
    })
}

/** Case-insensitive, all-words search across the fields people actually type. */
export function matchesSearch(item: Item, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [item.name, item.setName, item.setCode, item.cardNumber, item.variant, item.language, item.condition, item.gradingCompany, item.grade, item.kind, item.game, item.notes, item.tags.join(' ')]
    .join(' ')
    .toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Cost of each sale line from the FIFO calculation: `costOf(saleId, lineIndex)`. */
export function saleLineCosts(d: InventoryData): (saleId: string, lineIndex: number) => LineCost {
  const { supplies, demands } = supplyAndDemand(d)
  const { costByDemand } = allocateFifo(supplies, demands)
  return (saleId, i) => costByDemand.get(`${saleId}:${i}`) ?? { knownCostCents: 0, unknownCostQty: 0, oversoldQty: 0 }
}

/**
 * Value of cards that went out by total only, per person. It comes off that person's bulk cards, so
 * the bulk figure stays honest without anyone editing it by hand. Voided deals are ignored.
 */
export function looseOutByProfile(sales: Pick<Sale, 'looseOut' | 'voidedAt'>[]): Record<ProfileId, number> {
  const out: Record<ProfileId, number> = { p1: 0, p2: 0 }
  for (const s of sales) if (!s.voidedAt && s.looseOut) out[s.looseOut.ownerProfileId] += s.looseOut.valueCents
  return out
}

/** Bulk cards value for a profile, or both: what is recorded minus what went out by value. */
export function bulkValueCents(rows: InventoryRow[], loose: Record<ProfileId, number>, profile: ProfileId | 'all'): number {
  return Math.max(0, bulkRecordedCents(rows, profile) - (profile === 'all' ? loose.p1 + loose.p2 : loose[profile]))
}

export function bulkRecordedCents(rows: InventoryRow[], profile: ProfileId | 'all'): number {
  return rows.filter((r) => r.item.kind === 'bulk' && (profile === 'all' || r.item.profileId === profile)).reduce((n, r) => n + r.marketValueCents, 0)
}
