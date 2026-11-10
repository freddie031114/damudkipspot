import { allocateFifo, type Demand, type Supply } from '../domain/fifo'
import { effectiveSticker, type StickerRounding } from '../domain/sticker'
import type { Adjustment, Item, Lot, Sale } from './types'

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
}

export interface RawData {
  items: Item[]
  lots: Lot[]
  sales: Sale[]
  adjustments: Adjustment[]
}

const DAY = 86_400_000

/** Builds FIFO supply/demand from raw records. Soft-deleted lots and voided sales are ignored. */
export function supplyAndDemand(d: RawData): { supplies: Supply[]; demands: Demand[]; saleLineDemandIds: Map<string, string[]> } {
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

export function buildInventory(d: RawData, settings: Settings = DEFAULT_SETTINGS, now = Date.now()): InventoryRow[] {
  const { supplies, demands } = supplyAndDemand(d)
  const fifo = allocateFifo(supplies, demands)
  const stockByItem = new Map<string, Supply[]>()
  for (const s of supplies) (stockByItem.get(s.itemId) ?? stockByItem.set(s.itemId, []).get(s.itemId)!).push(s)

  return d.items
    .filter((i) => !i.deletedAt)
    .map((item) => {
      const qty = fifo.onHandByItem.get(item.id) ?? 0
      // Bulk is a lump-sum value, not something with a sticker: it counts at market.
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
      }
    })
}

/** Case-insensitive, all-words search across the fields people actually type. */
export function matchesSearch(item: Item, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [item.name, item.setName, item.setCode, item.cardNumber, item.variant, item.language, item.condition, item.grade, item.location, item.notes, item.tags.join(' ')]
    .join(' ')
    .toLowerCase()
  return words.every((w) => hay.includes(w))
}
