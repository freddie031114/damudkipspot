/**
 * Pure builders for every write. Each returns the Firestore operations to commit (the data
 * change AND its audit entry together) plus an optional inverse for undo. Nothing here
 * touches Firebase, so it is fully testable and identical online and offline.
 */
import { saleTotals, validateSale, type SaleDraft } from '../domain/sale'
import type { Adjustment, Item, Lot, ProfileId, Sale, WriteOp } from './types'
import { NEW_ITEM_DEFAULTS, type NewItem } from './types'

export interface Ctx {
  actor: ProfileId
  now: number
  newId: () => string
}

export interface Change {
  label: string
  ops: WriteOp[]
  /** Operations that reverse this change (built at undo time). */
  inverse?: (ctx: Ctx) => WriteOp[]
}

const stamp = (ctx: Ctx) => ({ updatedAt: ctx.now, updatedBy: ctx.actor })
const born = (ctx: Ctx) => ({ createdAt: ctx.now, createdBy: ctx.actor, ...stamp(ctx) })

function audit(
  ctx: Ctx,
  entity: string,
  entityId: string,
  action: string,
  target: ProfileId,
  diff: unknown = null,
): WriteOp {
  const id = ctx.newId()
  return {
    collection: 'auditLog',
    id,
    merge: false,
    data: { id, at: ctx.now, actorProfileId: ctx.actor, targetProfileId: target, entity, entityId, action, diff },
  }
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function priceHistoryOp(ctx: Ctx, itemId: string, cents: number, source = 'manual'): WriteOp {
  const id = ctx.newId()
  return {
    collection: 'priceHistory',
    id,
    merge: false,
    data: { id, itemId, marketPriceCents: cents, recordedAt: ctx.now, recordedBy: ctx.actor, source },
  }
}

// ---------- items ----------

export interface FirstLot {
  qty: number
  unitCostCents: number | null
  source?: Lot['source']
}

export function createItem(ctx: Ctx, input: Partial<NewItem> & Pick<NewItem, 'profileId' | 'name'>, first?: FirstLot): Change {
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  if (input.marketPriceCents !== undefined && (!Number.isInteger(input.marketPriceCents) || input.marketPriceCents < 0)) {
    throw new Error('Market price must be zero or more')
  }
  const id = ctx.newId()
  const item: Item = {
    ...NEW_ITEM_DEFAULTS,
    ...input,
    name,
    id,
    marketPriceUpdatedAt: ctx.now,
    deletedAt: null,
    ...born(ctx),
  }
  const ops: WriteOp[] = [{ collection: 'items', id, data: item as unknown as Record<string, unknown>, merge: false }]
  const created = [id]
  const lotIds: string[] = []
  if (first && first.qty > 0) {
    if (!Number.isInteger(first.qty)) throw new Error('Quantity must be a whole number')
    const lot = lotOp(ctx, item.id, item.profileId, first.qty, first.unitCostCents, first.source ?? 'purchase', item.importBatchId)
    ops.push(lot)
    lotIds.push(lot.id)
  }
  if (item.marketPriceCents > 0) ops.push(priceHistoryOp(ctx, id, item.marketPriceCents))
  ops.push(audit(ctx, 'item', id, 'create', item.profileId, { name, qty: first?.qty ?? 0 }))
  return {
    label: `Added ${name}`,
    ops,
    inverse: (c) => [
      ...created.map((i) => softDeleteOp(c, 'items', i, true)),
      ...lotIds.map((l) => softDeleteOp(c, 'lots', l, true)),
      audit(c, 'item', id, 'undo-create', item.profileId),
    ],
  }
}

export function lotOp(
  ctx: Ctx, itemId: string, profileId: ProfileId, qty: number, unitCostCents: number | null,
  source: Lot['source'] = 'purchase', importBatchId: string | null = null,
): WriteOp {
  if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of at least 1')
  if (unitCostCents !== null && (!Number.isInteger(unitCostCents) || unitCostCents < 0)) throw new Error('Cost must be zero or more')
  const id = ctx.newId()
  const lot: Lot = {
    id, itemId, profileId, acquiredAt: ctx.now, qty, unitCostCents, source, note: '', importBatchId, deletedAt: null, ...born(ctx),
  }
  return { collection: 'lots', id, merge: false, data: lot as unknown as Record<string, unknown> }
}

export function addLot(ctx: Ctx, item: Item, qty: number, unitCostCents: number | null): Change {
  const op = lotOp(ctx, item.id, item.profileId, qty, unitCostCents)
  return {
    label: `Added ${qty} x ${item.name}`,
    ops: [op, audit(ctx, 'lot', op.id, 'create', item.profileId, { itemId: item.id, qty, unitCostCents })],
    inverse: (c) => [softDeleteOp(c, 'lots', op.id, true), audit(c, 'lot', op.id, 'undo-create', item.profileId)],
  }
}

export type ItemEdit = Partial<Pick<Item,
  'name' | 'setName' | 'setCode' | 'cardNumber' | 'language' | 'variant' | 'condition' | 'gradingCompany' | 'grade' |
  'sealedType' | 'kind' | 'game' | 'marketPriceCents' | 'stickerOverrideCents' | 'location' | 'notes' | 'tags' | 'lowStockThreshold'>>

/** Updates only the fields that actually changed; the audit entry keeps before/after. */
export function updateItem(ctx: Ctx, before: Item, edit: ItemEdit): Change | null {
  const changed: Record<string, unknown> = {}
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  const old: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(edit)) {
    const prev = (before as unknown as Record<string, unknown>)[k]
    if (v === undefined || sameValue(prev, v)) continue
    changed[k] = v
    old[k] = prev
    diff[k] = { from: prev, to: v }
  }
  if (Object.keys(changed).length === 0) return null
  if ('name' in changed && !String(changed.name).trim()) throw new Error('Name is required')
  if ('marketPriceCents' in changed) {
    const m = changed.marketPriceCents
    if (!Number.isInteger(m) || (m as number) < 0) throw new Error('Market price must be zero or more')
    changed.marketPriceUpdatedAt = ctx.now
  }
  const ops: WriteOp[] = [{ collection: 'items', id: before.id, merge: true, data: { ...changed, ...stamp(ctx) } }]
  if ('marketPriceCents' in changed) ops.push(priceHistoryOp(ctx, before.id, changed.marketPriceCents as number))
  ops.push(audit(ctx, 'item', before.id, 'update', before.profileId, diff))
  return {
    label: `Edited ${before.name}`,
    ops,
    inverse: (c) => {
      const back: Record<string, unknown> = { ...old, ...stamp(c) }
      if ('marketPriceCents' in old) back.marketPriceUpdatedAt = c.now
      const inv: WriteOp[] = [{ collection: 'items', id: before.id, merge: true, data: back }]
      if ('marketPriceCents' in old) inv.push(priceHistoryOp(c, before.id, old.marketPriceCents as number, 'undo'))
      inv.push(audit(c, 'item', before.id, 'undo-update', before.profileId))
      return inv
    },
  }
}

function softDeleteOp(ctx: Ctx, collection: 'items' | 'lots', id: string, deleted: boolean): WriteOp {
  return { collection, id, merge: true, data: { deletedAt: deleted ? ctx.now : null, ...stamp(ctx) } }
}

export function deleteItems(ctx: Ctx, items: Item[]): Change {
  const ops: WriteOp[] = []
  for (const it of items) {
    ops.push(softDeleteOp(ctx, 'items', it.id, true), audit(ctx, 'item', it.id, 'delete', it.profileId, { name: it.name }))
  }
  return {
    label: items.length === 1 ? `Deleted ${items[0]!.name}` : `Deleted ${items.length} items`,
    ops,
    inverse: (c) => restoreItems(c, items).ops,
  }
}

export function restoreItems(ctx: Ctx, items: Item[]): Change {
  const ops: WriteOp[] = []
  for (const it of items) {
    ops.push(softDeleteOp(ctx, 'items', it.id, false), audit(ctx, 'item', it.id, 'restore', it.profileId))
  }
  return { label: `Restored ${items.length} item(s)`, ops, inverse: (c) => deleteItems(c, items).ops }
}

// ---------- stock adjustments ----------

export function adjustStock(ctx: Ctx, item: Item, qtyDelta: number, reason: Adjustment['reason'], note = ''): Change {
  if (!Number.isInteger(qtyDelta) || qtyDelta === 0) throw new Error('Adjustment must be a non-zero whole number')
  const id = ctx.newId()
  const adj: Adjustment = { id, itemId: item.id, profileId: item.profileId, qtyDelta, reason, note, ...born(ctx) }
  return {
    label: `${qtyDelta > 0 ? '+' : ''}${qtyDelta} ${item.name}`,
    ops: [
      { collection: 'adjustments', id, merge: false, data: adj as unknown as Record<string, unknown> },
      audit(ctx, 'adjustment', id, 'create', item.profileId, { itemId: item.id, qtyDelta, reason }),
    ],
    // Undo = the opposite adjustment (adjustments are append-only).
    inverse: (c) => adjustStock(c, item, -qtyDelta, reason, 'undo').ops,
  }
}

// ---------- sales ----------

export function recordSale(ctx: Ctx, draft: SaleDraft, opts: { showId?: string | null; note?: string } = {}): Change & { saleId: string } {
  const errors = validateSale(draft)
  if (errors.length) throw new Error(errors.join('. '))
  const id = ctx.newId()
  const sale: Sale = {
    id,
    soldByProfileId: draft.soldByProfileId,
    showId: opts.showId ?? null,
    soldAt: ctx.now,
    note: opts.note ?? '',
    discountCents: draft.discountCents,
    lines: draft.lines,
    payments: draft.payments,
    voidedAt: null,
    voidedBy: null,
    ...born(ctx),
  }
  const total = saleTotals(draft).totalCents
  const owners = [...new Set(draft.lines.map((l) => l.ownerProfileId))]
  return {
    saleId: id,
    label: `Sale ${(total / 100).toFixed(2)}`,
    ops: [
      { collection: 'sales', id, merge: false, data: sale as unknown as Record<string, unknown> },
      audit(ctx, 'sale', id, 'create', owners[0]!, { totalCents: total, lines: draft.lines.length, owners }),
    ],
    inverse: (c) => voidSale(c, sale)?.ops ?? [],
  }
}

/** Voiding is idempotent: an already-voided sale produces no operations. */
export function voidSale(ctx: Ctx, sale: Sale): Change | null {
  if (sale.voidedAt) return null
  return {
    label: 'Sale voided',
    ops: [
      { collection: 'sales', id: sale.id, merge: true, data: { voidedAt: ctx.now, voidedBy: ctx.actor, ...stamp(ctx) } },
      audit(ctx, 'sale', sale.id, 'void', sale.lines[0]?.ownerProfileId ?? ctx.actor),
    ],
  }
}
