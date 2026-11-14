/**
 * Pure builders for every write. Each returns the Firestore operations to commit (the data
 * change AND its audit entry together) plus an optional inverse for undo. Nothing here
 * touches Firebase, so it is fully testable and identical online and offline.
 */
import { isoDay } from '../domain/expenses'
import { saleTotals, tradeCreditCents, tradeInputCreditCents, validateSale, type SaleDraft, type SaleTradeIn } from '../domain/sale'
import type { Adjustment, Item, Lot, ProfileDoc, ProfileId, Sale, Show, ShowExpense, WriteOp } from './types'
import { NEW_ITEM_DEFAULTS, type NewItem } from './types'
import type { ImportRow } from '../import/types'

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

export function makeItem(ctx: Ctx, input: Partial<NewItem> & Pick<NewItem, 'profileId' | 'name'>): Item {
  return {
    ...NEW_ITEM_DEFAULTS,
    ...input,
    id: ctx.newId(),
    marketPriceUpdatedAt: ctx.now,
    deletedAt: null,
    ...born(ctx),
  }
}

export function createItem(ctx: Ctx, input: Partial<NewItem> & Pick<NewItem, 'profileId' | 'name'>, first?: FirstLot): Change {
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  if (input.marketPriceCents !== undefined && (!Number.isInteger(input.marketPriceCents) || input.marketPriceCents < 0)) {
    throw new Error('Market price must be zero or more')
  }
  const item = makeItem(ctx, { ...input, name })
  const id = item.id
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
  'sealedType' | 'kind' | 'game' | 'marketPriceCents' | 'stickerOverrideCents' | 'stickeredPriceCents' | 'notes' | 'tags' | 'lowStockThreshold'>>

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
    changed.previousMarketPriceCents = before.marketPriceCents
    old.previousMarketPriceCents = before.previousMarketPriceCents
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

  // Cards taken in trade become new stock: a lot per trade-in, costed at the credit given.
  // The lot is dated now, so it never feeds a sale that happened before it.
  const tradeIns: SaleTradeIn[] = []
  const tradeOps: WriteOp[] = []
  for (const t of draft.tradeIns ?? []) {
    let itemId = t.itemId
    let createdItem = false
    if (itemId === null) {
      const n = t.item!
      const item = makeItem(ctx, {
        profileId: t.ownerProfileId, name: n.name.trim(), setName: n.setName.trim(), cardNumber: n.cardNumber.trim(),
        variant: n.variant.trim(), condition: n.condition.trim(), game: n.game || 'Pokémon',
        marketPriceCents: n.marketPriceCents > 0 ? n.marketPriceCents : Math.round(tradeInputCreditCents(t) / t.qty),
      })
      itemId = item.id
      createdItem = true
      tradeOps.push({ collection: 'items', id: item.id, merge: false, data: item as unknown as Record<string, unknown> })
      if (item.marketPriceCents > 0) tradeOps.push(priceHistoryOp(ctx, item.id, item.marketPriceCents, 'trade-in'))
    }
    // A lump credit that does not divide evenly is split into two lots a cent apart, so the
    // stock's cost adds up to exactly what was given for it.
    const total = tradeInputCreditCents(t)
    const base = Math.floor(total / t.qty)
    const extra = total - base * t.qty
    const parts = extra === 0 ? [{ qty: t.qty, each: base }] : [{ qty: t.qty - extra, each: base }, { qty: extra, each: base + 1 }]
    parts.forEach((part, k) => {
      const lot = lotOp(ctx, itemId!, t.ownerProfileId, part.qty, part.each, 'trade-in')
      lot.data.saleId = id
      lot.data.note = 'Trade-in'
      tradeOps.push(lot)
      tradeIns.push({ itemId: itemId!, ownerProfileId: t.ownerProfileId, qty: part.qty, creditCents: part.each, lotId: lot.id, createdItem: createdItem && k === 0 })
    })
  }

  const sale: Sale = {
    id,
    soldByProfileId: draft.soldByProfileId,
    showId: opts.showId ?? null,
    soldAt: ctx.now,
    note: opts.note ?? '',
    discountCents: draft.discountCents,
    lines: draft.lines,
    payments: draft.payments,
    ...(tradeIns.length ? { tradeIns } : {}),
    ...(draft.looseOut ? { looseOut: draft.looseOut } : {}),
    voidedAt: null,
    voidedBy: null,
    ...born(ctx),
  }
  const total = saleTotals(draft).totalCents
  const owners = [...new Set(draft.lines.map((l) => l.ownerProfileId))]
  const cash = draft.payments.filter((p) => p.method !== 'trade').reduce((n, p) => n + p.amountCents, 0)
  const unitsIn = tradeIns.reduce((n, t) => n + t.qty, 0)
  return {
    saleId: id,
    label: draft.lines.length === 0 && !draft.looseOut
      ? `Bought ${unitsIn} card${unitsIn === 1 ? '' : 's'} for ${(-cash / 100).toFixed(2)}`
      : tradeIns.length ? `Trade logged${cash === 0 ? '' : cash > 0 ? `, they paid ${(cash / 100).toFixed(2)}` : `, we paid ${(-cash / 100).toFixed(2)}`}` : `Sale ${(total / 100).toFixed(2)}`,
    ops: [
      { collection: 'sales', id, merge: false, data: sale as unknown as Record<string, unknown> },
      ...tradeOps,
      audit(ctx, 'sale', id, 'create', owners[0] ?? draft.looseOut?.ownerProfileId ?? tradeIns[0]?.ownerProfileId ?? ctx.actor, {
        totalCents: total, cashCents: cash, lines: draft.lines.length, owners,
        ...(draft.looseOut ? { looseOutCents: draft.looseOut.valueCents } : {}),
        ...(tradeIns.length ? { tradeIns: tradeIns.length, tradeCreditCents: tradeCreditCents(tradeIns) } : {}),
      }),
    ],
    inverse: (c) => voidSale(c, sale)?.ops ?? [],
  }
}

/**
 * Voiding is idempotent: an already-voided sale produces no operations. Voiding a trade also
 * takes the cards received back out of stock (and removes any item the trade created).
 */
export function voidSale(ctx: Ctx, sale: Sale): Change | null {
  if (sale.voidedAt) return null
  const trades = sale.tradeIns ?? []
  return {
    label: sale.lines.length === 0 && !sale.looseOut ? 'Buy voided' : trades.length ? 'Trade voided' : 'Sale voided',
    ops: [
      { collection: 'sales', id: sale.id, merge: true, data: { voidedAt: ctx.now, voidedBy: ctx.actor, ...stamp(ctx) } },
      ...trades.flatMap((t) => [
        softDeleteOp(ctx, 'lots', t.lotId, true),
        ...(t.createdItem ? [softDeleteOp(ctx, 'items', t.itemId, true)] : []),
      ]),
      audit(ctx, 'sale', sale.id, 'void', sale.lines[0]?.ownerProfileId ?? ctx.actor),
    ],
  }
}

// ---------- bulk import ----------



/**
 * Imports reviewed rows as new items with opening lots. One audit entry and one importBatches
 * record cover the whole import, and the inverse soft-deletes everything it created.
 */
export function importItems(ctx: Ctx, rows: ImportRow[], filename: string): Change & { count: number; batchId: string } {
  const use = rows.filter((r) => r.include && r.marketCents !== null && r.blocking.length === 0)
  if (use.length === 0) throw new Error('Nothing to import')
  const batchId = ctx.newId()
  const ops: WriteOp[] = [
    {
      collection: 'importBatches', id: batchId, merge: false,
      data: { id: batchId, filename, rowCount: use.length, profileIds: [...new Set(use.map((r) => r.profileId))], undoneAt: null, ...born(ctx) },
    },
  ]
  const itemIds: string[] = []
  const lotIds: string[] = []
  for (const r of use) {
    const name = r.name.trim()
    if (!name) throw new Error(`${r.source}: name is required`)
    if (!Number.isInteger(r.qty) || r.qty < 1) throw new Error(`${r.source}: quantity must be a whole number of at least 1`)
    const item = makeItem(ctx, {
      profileId: r.profileId, name, kind: r.kind, game: r.game, setName: r.setName, cardNumber: r.cardNumber,
      language: r.language, variant: r.variant, condition: r.condition, gradingCompany: r.gradingCompany, grade: r.grade,
      marketPriceCents: r.marketCents!, stickerOverrideCents: r.stickerOverrideCents, stickeredPriceCents: r.stickeredCents, importBatchId: batchId,
    })
    const lot = lotOp(ctx, item.id, item.profileId, r.qty, r.costCents, r.costCents === null ? 'opening' : 'import', batchId)
    ops.push({ collection: 'items', id: item.id, merge: false, data: item as unknown as Record<string, unknown>, atom: item.id })
    ops.push({ ...lot, atom: item.id })
    if (item.marketPriceCents > 0) ops.push({ ...priceHistoryOp(ctx, item.id, item.marketPriceCents, 'import'), atom: item.id })
    itemIds.push(item.id)
    lotIds.push(lot.id)
  }
  ops.push(audit(ctx, 'import', batchId, 'import', use[0]!.profileId, { filename, rows: use.length }))
  return {
    count: use.length,
    batchId,
    label: `Imported ${use.length} items`,
    ops,
    inverse: (c) => [
      ...itemIds.map((i) => ({ ...softDeleteOp(c, 'items', i, true), atom: i })),
      ...lotIds.map((l, n) => ({ ...softDeleteOp(c, 'lots', l, true), atom: itemIds[n]! })),
      { collection: 'importBatches' as const, id: batchId, merge: true, data: { undoneAt: c.now, ...stamp(c) } },
      audit(c, 'import', batchId, 'undo-import', use[0]!.profileId),
    ],
  }
}

// ---------- lots ----------

export type LotEdit = Partial<Pick<Lot, 'unitCostCents' | 'qty' | 'note' | 'acquiredAt'>>

/** Editing a lot's cost changes the cost of goods on any sale that used it (FIFO is derived). */
export function updateLot(ctx: Ctx, before: Lot, edit: LotEdit, itemName = 'item'): Change | null {
  const changed: Record<string, unknown> = {}
  const old: Record<string, unknown> = {}
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const [k, v] of Object.entries(edit)) {
    const prev = (before as unknown as Record<string, unknown>)[k]
    if (v === undefined || sameValue(prev, v)) continue
    changed[k] = v
    old[k] = prev
    diff[k] = { from: prev, to: v }
  }
  if (Object.keys(changed).length === 0) return null
  if ('qty' in changed && (!Number.isInteger(changed.qty) || (changed.qty as number) < 1)) throw new Error('Quantity must be a whole number of at least 1')
  if ('unitCostCents' in changed && changed.unitCostCents !== null && (!Number.isInteger(changed.unitCostCents) || (changed.unitCostCents as number) < 0)) {
    throw new Error('Cost must be zero or more')
  }
  return {
    label: `Edited stock lot of ${itemName}`,
    ops: [
      { collection: 'lots', id: before.id, merge: true, data: { ...changed, ...stamp(ctx) } },
      audit(ctx, 'lot', before.id, 'update', before.profileId, diff),
    ],
    inverse: (c) => [
      { collection: 'lots', id: before.id, merge: true, data: { ...old, ...stamp(c) } },
      audit(c, 'lot', before.id, 'undo-update', before.profileId),
    ],
  }
}

export function deleteLot(ctx: Ctx, lot: Lot, itemName = 'item'): Change {
  return {
    label: `Removed a stock lot of ${itemName}`,
    ops: [softDeleteOp(ctx, 'lots', lot.id, true), audit(ctx, 'lot', lot.id, 'delete', lot.profileId, { qty: lot.qty })],
    inverse: (c) => [softDeleteOp(c, 'lots', lot.id, false), audit(c, 'lot', lot.id, 'restore', lot.profileId)],
  }
}

// ---------- shows ----------

const EVEN: Record<ProfileId, number> = { p1: 50, p2: 50 }

function expenseDoc(
  ctx: Ctx, showId: string | null, description: string, amountCents: number, paidBy: ProfileId, splitPct: Record<ProfileId, number>,
  extra: { category?: string; incurredOn?: string } = {},
): ShowExpense {
  if (!description.trim()) throw new Error('Describe the expense')
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Expense amount must be more than zero')
  if (splitPct.p1 + splitPct.p2 !== 100 || splitPct.p1 < 0 || splitPct.p2 < 0) throw new Error('The split must add up to 100%')
  const incurredOn = extra.incurredOn || isoDay(ctx.now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)) throw new Error('Enter a valid date')
  return {
    id: ctx.newId(), showId, description: description.trim(), amountCents, paidByProfileId: paidBy, splitPct,
    category: extra.category || 'Other', incurredOn, settledAt: null, deletedAt: null, ...born(ctx),
  }
}

export interface NewShow {
  name: string
  startsOn: string
  endsOn: string
  venue: string
  tableFeeCents: number
  /** Who paid the table fee (defaults to the person creating the show). */
  feePaidBy?: ProfileId
  notes?: string
}

export function createShow(ctx: Ctx, input: NewShow): Change & { showId: string } {
  const name = input.name.trim()
  if (!name) throw new Error('Name the show')
  if (!Number.isInteger(input.tableFeeCents) || input.tableFeeCents < 0) throw new Error('Table fee must be zero or more')
  if (input.endsOn && input.startsOn && input.endsOn < input.startsOn) throw new Error('The show cannot end before it starts')
  const id = ctx.newId()
  const ops: WriteOp[] = []
  let feeId: string | null = null
  if (input.tableFeeCents > 0) {
    const fee = expenseDoc(ctx, id, 'Table fee', input.tableFeeCents, input.feePaidBy ?? ctx.actor, EVEN, { category: 'Table fee', incurredOn: input.startsOn })
    feeId = fee.id
    ops.push({ collection: 'showExpenses', id: fee.id, merge: false, data: fee as unknown as Record<string, unknown> })
  }
  const show: Show = {
    id, name, startsOn: input.startsOn, endsOn: input.endsOn || input.startsOn, venue: input.venue.trim(), tableFeeCents: input.tableFeeCents,
    status: 'planned', notes: input.notes ?? '', feeExpenseId: feeId, deletedAt: null,
    participants: [
      { profileId: 'p1', openingFloatCents: 0, closingCashCents: null },
      { profileId: 'p2', openingFloatCents: 0, closingCashCents: null },
    ],
    ...born(ctx),
  }
  ops.unshift({ collection: 'shows', id, merge: false, data: show as unknown as Record<string, unknown> })
  ops.push(audit(ctx, 'show', id, 'create', ctx.actor, { name }))
  return {
    showId: id, label: `Created show ${name}`, ops,
    inverse: (c) => [{ collection: 'shows', id, merge: true, data: { deletedAt: c.now, ...stamp(c) } }, audit(c, 'show', id, 'undo-create', ctx.actor)],
  }
}

export type ShowEdit = Partial<Pick<Show, 'name' | 'startsOn' | 'endsOn' | 'venue' | 'notes' | 'status' | 'tableFeeCents'>>

export function updateShow(ctx: Ctx, before: Show, edit: ShowEdit): Change | null {
  const changed: Record<string, unknown> = {}
  const old: Record<string, unknown> = {}
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const [k, v] of Object.entries(edit)) {
    const prev = (before as unknown as Record<string, unknown>)[k]
    if (v === undefined || sameValue(prev, v)) continue
    changed[k] = v
    old[k] = prev
    diff[k] = { from: prev, to: v }
  }
  if (Object.keys(changed).length === 0) return null
  if ('name' in changed && !String(changed.name).trim()) throw new Error('Name the show')
  const ops: WriteOp[] = []
  if ('tableFeeCents' in changed) {
    const fee = changed.tableFeeCents
    if (!Number.isInteger(fee) || (fee as number) < 0) throw new Error('Table fee must be zero or more')
    if (before.feeExpenseId) {
      ops.push({ collection: 'showExpenses', id: before.feeExpenseId, merge: true, data: { amountCents: fee, deletedAt: (fee as number) === 0 ? ctx.now : null, ...stamp(ctx) } })
    } else if ((fee as number) > 0) {
      const e = expenseDoc(ctx, before.id, 'Table fee', fee as number, ctx.actor, EVEN, { category: 'Table fee', incurredOn: before.startsOn })
      changed.feeExpenseId = e.id
      ops.push({ collection: 'showExpenses', id: e.id, merge: false, data: e as unknown as Record<string, unknown> })
    }
  }
  ops.unshift({ collection: 'shows', id: before.id, merge: true, data: { ...changed, ...stamp(ctx) } })
  ops.push(audit(ctx, 'show', before.id, 'update', ctx.actor, diff))
  return {
    label: `Edited show ${before.name}`,
    ops,
    inverse: (c) => [
      { collection: 'shows', id: before.id, merge: true, data: { ...old, ...stamp(c) } },
      ...(before.feeExpenseId && 'tableFeeCents' in old
        ? [{ collection: 'showExpenses' as const, id: before.feeExpenseId, merge: true, data: { amountCents: old.tableFeeCents, deletedAt: (old.tableFeeCents as number) === 0 ? c.now : null, ...stamp(c) } }]
        : []),
      audit(c, 'show', before.id, 'undo-update', ctx.actor),
    ],
  }
}

/** Sets a person's opening float and/or counted closing cash for a show. */
export function setParticipant(ctx: Ctx, show: Show, profileId: ProfileId, patch: { openingFloatCents?: number; closingCashCents?: number | null }): Change {
  if (patch.openingFloatCents !== undefined && (!Number.isInteger(patch.openingFloatCents) || patch.openingFloatCents < 0)) throw new Error('Float must be zero or more')
  if (patch.closingCashCents != null && (!Number.isInteger(patch.closingCashCents) || patch.closingCashCents < 0)) throw new Error('Cash count must be zero or more')
  const participants = (['p1', 'p2'] as const).map((id) => {
    const cur = show.participants.find((p) => p.profileId === id) ?? { profileId: id, openingFloatCents: 0, closingCashCents: null }
    return id === profileId ? { ...cur, ...patch } : cur
  })
  return {
    label: 'Updated cash float',
    ops: [
      { collection: 'shows', id: show.id, merge: true, data: { participants, ...stamp(ctx) } },
      audit(ctx, 'show', show.id, 'update', profileId, { participants: patch }),
    ],
    inverse: (c) => [{ collection: 'shows', id: show.id, merge: true, data: { participants: show.participants, ...stamp(c) } }, audit(c, 'show', show.id, 'undo-update', profileId)],
  }
}

/** Adds a cost to split. `showId` is null for costs that belong to no particular show. */
export function addExpense(
  ctx: Ctx, showId: string | null,
  input: { description: string; amountCents: number; paidBy: ProfileId; splitPct?: Record<ProfileId, number>; category?: string; incurredOn?: string },
): Change {
  const e = expenseDoc(ctx, showId, input.description, input.amountCents, input.paidBy, input.splitPct ?? EVEN, { category: input.category, incurredOn: input.incurredOn })
  return {
    label: `Added expense ${e.description}`,
    ops: [
      { collection: 'showExpenses', id: e.id, merge: false, data: e as unknown as Record<string, unknown> },
      audit(ctx, 'expense', e.id, 'create', input.paidBy, { showId, amountCents: e.amountCents }),
    ],
    inverse: (c) => [{ collection: 'showExpenses', id: e.id, merge: true, data: { deletedAt: c.now, ...stamp(c) } }, audit(c, 'expense', e.id, 'undo-create', input.paidBy)],
  }
}

/** Marks costs as squared up between the two people. Undo makes them owed again. */
export function settleExpenses(ctx: Ctx, expenses: ShowExpense[]): Change | null {
  const open = expenses.filter((e) => !e.deletedAt && !e.settledAt)
  if (open.length === 0) return null
  const set = (c: Ctx, value: number | null): WriteOp[] => open.map((e) => ({ collection: 'showExpenses', id: e.id, merge: true, data: { settledAt: value, ...stamp(c) } }))
  const total = open.reduce((n, e) => n + e.amountCents, 0)
  return {
    label: `Settled ${open.length} cost${open.length === 1 ? '' : 's'}`,
    ops: [...set(ctx, ctx.now), audit(ctx, 'expense', open[0]!.id, 'settle', ctx.actor, { count: open.length, totalCents: total })],
    inverse: (c) => [...set(c, null), audit(c, 'expense', open[0]!.id, 'undo-settle', ctx.actor)],
  }
}

export function deleteExpense(ctx: Ctx, e: ShowExpense): Change {
  return {
    label: `Removed expense ${e.description}`,
    ops: [{ collection: 'showExpenses', id: e.id, merge: true, data: { deletedAt: ctx.now, ...stamp(ctx) } }, audit(ctx, 'expense', e.id, 'delete', e.paidByProfileId)],
    inverse: (c) => [{ collection: 'showExpenses', id: e.id, merge: true, data: { deletedAt: null, ...stamp(c) } }, audit(c, 'expense', e.id, 'restore', e.paidByProfileId)],
  }
}

// ---------- settings ----------

/** Writes the whole settings object for a profile (merged with what was there). */
export function updateSettings(ctx: Ctx, doc: ProfileDoc, patch: NonNullable<ProfileDoc['settings']>): Change {
  const next = { ...(doc.settings ?? {}), ...patch }
  if (next.multiplierPermille !== undefined && (!Number.isInteger(next.multiplierPermille) || next.multiplierPermille < 500 || next.multiplierPermille > 5000)) {
    throw new Error('Sticker multiplier must be between 0.5x and 5x')
  }
  return {
    label: 'Saved settings',
    ops: [
      { collection: 'profiles', id: doc.id, merge: true, data: { id: doc.id, settings: next, ...stamp(ctx) } },
      audit(ctx, 'settings', doc.id, 'update', doc.id, patch),
    ],
    inverse: (c) => [{ collection: 'profiles', id: doc.id, merge: true, data: { id: doc.id, settings: doc.settings ?? {}, ...stamp(c) } }, audit(c, 'settings', doc.id, 'undo-update', doc.id)],
  }
}

// ---------- combining changes ----------

/** Joins several changes into one (one toast, one undo). Empty or null changes are skipped. */
export function combineChanges(label: string, changes: (Change | null)[]): Change | null {
  const real = changes.filter((c): c is Change => c !== null)
  if (real.length === 0) return null
  return {
    label,
    ops: real.flatMap((c) => c.ops),
    inverse: (ctx) => [...real].reverse().flatMap((c) => c.inverse?.(ctx) ?? []),
  }
}

/** Records that the chosen items now carry a sticker at their current sticker price. */
export function markStickered(ctx: Ctx, rows: { item: Item; sticker: number }[]): Change | null {
  return combineChanges(
    rows.length === 1 ? `Marked ${rows[0]!.item.name} as stickered` : `Marked ${rows.length} items as stickered`,
    rows.map((r) => updateItem(ctx, r.item, { stickeredPriceCents: r.sticker })),
  )
}
