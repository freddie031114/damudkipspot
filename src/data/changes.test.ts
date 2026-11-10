import { describe, expect, it } from 'vitest'
import { quickSale } from '../domain/sale'
import { addLot, adjustStock, createItem, deleteItems, recordSale, updateItem, voidSale } from './changes'
import { buildInventory, matchesSearch } from './derive'
import type { Adjustment, Item, Lot, Sale } from './types'

let n = 0
const ctx = (actor: 'p1' | 'p2' = 'p1', now = 1_000) => ({ actor, now, newId: () => `id${++n}` })

function applyOps(store: { items: Item[]; lots: Lot[]; sales: Sale[]; adjustments: Adjustment[] }, ops: { collection: string; id: string; data: Record<string, unknown>; merge: boolean }[]) {
  const map: Record<string, any[]> = { items: store.items, lots: store.lots, sales: store.sales, adjustments: store.adjustments }
  for (const op of ops) {
    const list = map[op.collection]
    if (!list) continue
    const i = list.findIndex((x) => x.id === op.id)
    if (op.merge && i >= 0) list[i] = { ...list[i], ...op.data }
    else if (i >= 0) list[i] = op.data
    else list.push(op.data)
  }
}
const empty = () => ({ items: [] as Item[], lots: [] as Lot[], sales: [] as Sale[], adjustments: [] as Adjustment[] })

describe('createItem', () => {
  it('writes item, first lot, price history and one audit entry together', () => {
    const c = createItem(ctx(), { profileId: 'p2', name: 'Charizard 183/165', marketPriceCents: 7000 }, { qty: 2, unitCostCents: 3000 })
    expect(c.ops.map((o) => o.collection).sort()).toEqual(['auditLog', 'items', 'lots', 'priceHistory'])
    expect(c.ops.find((o) => o.collection === 'auditLog')!.data).toMatchObject({ actorProfileId: 'p1', targetProfileId: 'p2', action: 'create' })
  })
  it('rejects a blank name', () => expect(() => createItem(ctx(), { profileId: 'p1', name: '  ' })).toThrow('Name is required'))
  it('undo soft-deletes what was created', () => {
    const s = empty()
    const c = createItem(ctx(), { profileId: 'p1', name: 'X', marketPriceCents: 100 }, { qty: 1, unitCostCents: null })
    applyOps(s, c.ops)
    applyOps(s, c.inverse!(ctx('p1', 2_000)))
    expect(buildInventory(s, undefined, 3_000)).toHaveLength(0)
    expect(s.lots[0]!.deletedAt).toBe(2_000)
  })
})

describe('updateItem', () => {
  const item = { id: 'i1', profileId: 'p1', name: 'A', marketPriceCents: 1000, location: '', tags: [] } as unknown as Item
  it('returns null when nothing changed', () => expect(updateItem(ctx(), item, { name: 'A', location: '' })).toBeNull())
  it('writes only changed fields, logs before/after and records price history', () => {
    const c = updateItem(ctx(), item, { marketPriceCents: 1200, location: 'Box 1', name: 'A' })!
    const patch = c.ops[0]!.data
    expect(patch).toMatchObject({ marketPriceCents: 1200, location: 'Box 1' })
    expect('name' in patch).toBe(false)
    expect(c.ops.some((o) => o.collection === 'priceHistory')).toBe(true)
    expect(c.ops.at(-1)!.data.diff).toEqual({ marketPriceCents: { from: 1000, to: 1200 }, location: { from: '', to: 'Box 1' } })
  })
  it('inverse restores the old values', () => {
    const c = updateItem(ctx(), item, { location: 'Box 1' })!
    expect(c.inverse!(ctx())[0]!.data).toMatchObject({ location: '' })
  })
  it('rejects a negative market price', () => expect(() => updateItem(ctx(), item, { marketPriceCents: -5 })).toThrow())
})

describe('stock through sales, voids and deletes', () => {
  it('sale decrements stock, void restores it, a second void is a no-op', () => {
    const s = empty()
    applyOps(s, createItem(ctx(), { profileId: 'p2', name: 'Gengar', marketPriceCents: 8000 }, { qty: 3, unitCostCents: null, source: 'opening' }).ops)
    const item = s.items[0]!
    const sale = recordSale(ctx('p1', 5_000), quickSale({ soldByProfileId: 'p1', itemId: item.id, ownerProfileId: 'p2', stickerPriceCents: 8800, method: 'cash' }))
    applyOps(s, sale.ops)
    expect(buildInventory(s)[0]!.qty).toBe(2)
    const saved = s.sales[0]!
    expect(saved.soldByProfileId).toBe('p1')
    applyOps(s, voidSale(ctx('p1', 6_000), saved)!.ops)
    expect(buildInventory(s)[0]!.qty).toBe(3)
    expect(voidSale(ctx(), s.sales[0]!)).toBeNull()
  })
  it('sale undo (inverse) voids it', () => {
    const s = empty()
    applyOps(s, createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 100 }, { qty: 1, unitCostCents: 50 }).ops)
    const sale = recordSale(ctx(), quickSale({ soldByProfileId: 'p1', itemId: s.items[0]!.id, ownerProfileId: 'p1', stickerPriceCents: 110, method: 'card' }))
    applyOps(s, sale.ops)
    applyOps(s, sale.inverse!(ctx('p1', 9_000)))
    expect(buildInventory(s)[0]!.qty).toBe(1)
  })
  it('selling more than stock is allowed and flagged oversold', () => {
    const s = empty()
    applyOps(s, createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 100 }, { qty: 1, unitCostCents: 50 }).ops)
    const id = s.items[0]!.id
    applyOps(s, recordSale(ctx(), quickSale({ soldByProfileId: 'p1', itemId: id, ownerProfileId: 'p1', stickerPriceCents: 110, qty: 3, method: 'cash' })).ops)
    const row = buildInventory(s)[0]!
    expect(row.qty).toBe(0)
    expect(row.oversold).toBe(2)
  })
  it('refuses an invalid sale', () => {
    const d = quickSale({ soldByProfileId: 'p1', itemId: 'x', ownerProfileId: 'p1', stickerPriceCents: 100, method: 'cash' })
    d.payments[0]!.amountCents = 1
    expect(() => recordSale(ctx(), d)).toThrow('Payments must add up')
  })
  it('adjustments, added lots and soft deletes flow through derived stock', () => {
    const s = empty()
    applyOps(s, createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 100 }, { qty: 2, unitCostCents: 10 }).ops)
    const item = s.items[0]!
    applyOps(s, addLot(ctx('p1', 2_000), item, 3, 20).ops)
    applyOps(s, adjustStock(ctx('p1', 3_000), item, -1, 'damaged').ops)
    const row = buildInventory(s)[0]!
    expect(row.qty).toBe(4)
    expect(row.knownCostCents).toBe(1 * 10 + 3 * 20)
    applyOps(s, deleteItems(ctx(), [item]).ops)
    expect(buildInventory(s)).toHaveLength(0)
  })
})

describe('derived flags and search', () => {
  it('flags unknown cost, low stock and stale prices', () => {
    const s = empty()
    applyOps(s, createItem(ctx('p1', 0), { profileId: 'p1', name: 'A', marketPriceCents: 100, lowStockThreshold: 1 }, { qty: 1, unitCostCents: null, source: 'opening' }).ops)
    const row = buildInventory(s, undefined, 40 * 86_400_000)[0]!
    expect(row).toMatchObject({ costUnknown: true, lowStock: true, stalePrice: true, sticker: 100 })
  })
  it('searches all words across fields', () => {
    const it = { name: 'Gengar', setName: 'Lost Origin', cardNumber: 'TG06/TG30', variant: '', language: 'EN', condition: 'LP', grade: '', location: 'Binder 2', notes: '', tags: [], setCode: '' } as unknown as Item
    expect(matchesSearch(it, 'gengar tg06')).toBe(true)
    expect(matchesSearch(it, 'gengar binder')).toBe(true)
    expect(matchesSearch(it, 'pikachu')).toBe(false)
    expect(matchesSearch(it, '')).toBe(true)
  })
})
