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
  const item = { id: 'i1', profileId: 'p1', name: 'A', marketPriceCents: 1000, notes: '', tags: [] } as unknown as Item
  it('returns null when nothing changed', () => expect(updateItem(ctx(), item, { name: 'A', notes: '' })).toBeNull())
  it('writes only changed fields, logs before/after and records price history', () => {
    const c = updateItem(ctx(), item, { marketPriceCents: 1200, notes: 'Box 1', name: 'A' })!
    const patch = c.ops[0]!.data
    expect(patch).toMatchObject({ marketPriceCents: 1200, notes: 'Box 1' })
    expect('name' in patch).toBe(false)
    expect(c.ops.some((o) => o.collection === 'priceHistory')).toBe(true)
    expect(c.ops.at(-1)!.data.diff).toEqual({ marketPriceCents: { from: 1000, to: 1200 }, notes: { from: '', to: 'Box 1' } })
  })
  it('inverse restores the old values', () => {
    const c = updateItem(ctx(), item, { notes: 'Box 1' })!
    expect(c.inverse!(ctx())[0]!.data).toMatchObject({ notes: '' })
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

describe('bulk items', () => {
  it('count at their lump-sum value with no sticker markup', () => {
    const s = empty()
    applyOps(s, createItem(ctx(), { profileId: 'p1', name: 'Bulk cards', kind: 'bulk', marketPriceCents: 175000 }, { qty: 1, unitCostCents: null, source: 'opening' }).ops)
    const row = buildInventory(s)[0]!
    expect(row.sticker).toBe(175000)
    expect(row.marketValueCents).toBe(175000)
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
    const it = { name: 'Gengar', setName: 'Lost Origin', cardNumber: 'TG06/TG30', variant: '', language: 'EN', condition: 'LP', grade: '', notes: '', tags: [], setCode: '' } as unknown as Item
    expect(matchesSearch(it, 'gengar tg06')).toBe(true)
    expect(matchesSearch(it, 'gengar lost origin')).toBe(true)
    expect(matchesSearch(it, 'pikachu')).toBe(false)
    expect(matchesSearch(it, '')).toBe(true)
    const slab = { name: 'Charizard 20th Ann', gradingCompany: 'PSA', grade: '10', kind: 'graded', game: 'Pokémon', setName: '', cardNumber: '', variant: '', language: 'EN', condition: '', notes: '', tags: [], setCode: '' } as unknown as Item
    expect(matchesSearch(slab, 'psa 10')).toBe(true)
    expect(matchesSearch(slab, 'psa 9')).toBe(false)
    expect(matchesSearch(slab, 'graded')).toBe(true)
  })
})

describe('trades', () => {
  function stocked() {
    const s = empty()
    applyOps(s, createItem(ctx(), { profileId: 'p1', name: 'Charizard', marketPriceCents: 8000 }, { qty: 1, unitCostCents: 5000 }).ops)
    return s
  }
  const newCard = (over = {}) => ({ itemId: null, ownerProfileId: 'p1' as const, qty: 2, creditCents: 1500, item: { name: 'Pikachu', setName: '', cardNumber: '25', variant: '', condition: 'NM', game: 'Pokémon', marketPriceCents: 0 }, ...over })

  it('a trade creates the new item and a lot costed at the credit given', () => {
    const s = stocked()
    const charizard = s.items[0]!
    const draft = quickSale({ soldByProfileId: 'p1', itemId: charizard.id, ownerProfileId: 'p1', stickerPriceCents: 8000, method: 'cash', tradeIns: [newCard()] })
    const c = recordSale(ctx('p1', 5_000), draft)
    applyOps(s, c.ops)

    const sale = s.sales[0]!
    expect(sale.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 3000], ['cash', 5000]])
    expect(sale.tradeIns).toHaveLength(1)

    const lot = s.lots.find((l) => l.source === 'trade-in')!
    expect(lot).toMatchObject({ qty: 2, unitCostCents: 1500, saleId: sale.id, profileId: 'p1' })
    const pika = s.items.find((i) => i.name === 'Pikachu')!
    expect(pika.marketPriceCents).toBe(1500) // defaults to the credit when no market price is given

    const rows = buildInventory(s, undefined, 6_000)
    expect(rows.find((r) => r.item.id === charizard.id)!.qty).toBe(0)
    expect(rows.find((r) => r.item.id === pika.id)).toMatchObject({ qty: 2, knownCostCents: 3000 })
  })

  it('cards traded in join an existing item instead of creating a duplicate', () => {
    const s = stocked()
    const charizard = s.items[0]!
    const draft = quickSale({ soldByProfileId: 'p1', itemId: charizard.id, ownerProfileId: 'p1', stickerPriceCents: 8000, method: 'cash', tradeIns: [{ itemId: charizard.id, ownerProfileId: 'p1', qty: 1, creditCents: 6000 }] })
    applyOps(s, recordSale(ctx('p1', 5_000), draft).ops)
    expect(s.items).toHaveLength(1)
    expect(s.sales[0]!.tradeIns![0]).toMatchObject({ createdItem: false, itemId: charizard.id })
    expect(buildInventory(s, undefined, 6_000)[0]!.qty).toBe(1)
  })

  it('the trade-in stock keeps the credit as its cost, so profit is worked out when it sells', () => {
    const s = stocked()
    const charizard = s.items[0]!
    applyOps(s, recordSale(ctx('p1', 5_000), quickSale({ soldByProfileId: 'p1', itemId: charizard.id, ownerProfileId: 'p1', stickerPriceCents: 8000, method: 'cash', tradeIns: [newCard({ qty: 1, creditCents: 3000 })] })).ops)
    const pika = s.items.find((i) => i.name === 'Pikachu')!
    applyOps(s, recordSale(ctx('p1', 7_000), quickSale({ soldByProfileId: 'p1', itemId: pika.id, ownerProfileId: 'p1', stickerPriceCents: 4000, method: 'cash' })).ops)
    const row = buildInventory(s, undefined, 8_000).find((r) => r.item.id === pika.id)!
    expect(row.qty).toBe(0)
    expect(row.oversold).toBe(0)
  })

  it('voiding the trade (or undoing it) removes the cards received and the item it created', () => {
    const s = stocked()
    const charizard = s.items[0]!
    const c = recordSale(ctx('p1', 5_000), quickSale({ soldByProfileId: 'p1', itemId: charizard.id, ownerProfileId: 'p1', stickerPriceCents: 8000, method: 'cash', tradeIns: [newCard()] }))
    applyOps(s, c.ops)
    applyOps(s, c.inverse!(ctx('p1', 6_000)))
    const rows = buildInventory(s, undefined, 7_000)
    expect(rows.map((r) => r.item.name)).toEqual(['Charizard'])
    expect(rows[0]!.qty).toBe(1)
    expect(s.lots.find((l) => l.source === 'trade-in')!.deletedAt).toBe(6_000)
    expect(s.sales[0]!.voidedAt).toBe(6_000)
    expect(voidSale(ctx(), s.sales[0]!)).toBeNull()
  })

  it('records the trade in the audit entry', () => {
    const s = stocked()
    const c = recordSale(ctx('p1', 5_000), quickSale({ soldByProfileId: 'p1', itemId: s.items[0]!.id, ownerProfileId: 'p1', stickerPriceCents: 8000, method: 'cash', tradeIns: [newCard()] }))
    expect(c.ops.find((o) => o.collection === 'auditLog')!.data.diff).toMatchObject({ tradeIns: 1, tradeCreditCents: 3000 })
    expect(c.label).toMatch(/^Trade /)
  })
})

describe('deals', () => {
  it('a buy brings cards into stock at what was paid, to the exact cent, and voiding removes them', async () => {
    const { dealToDraft } = await import('../domain/deal')
    const s = empty()
    const c = recordSale(ctx('p1', 5_000), dealToDraft({
      by: 'p1', out: [], cashCents: -1000, method: 'cash',
      incoming: [{ itemId: null, ownerProfileId: 'p2', name: 'Eevee', cardNumber: '133', qty: 3, worthCents: null }],
    }))
    applyOps(s, c.ops)
    expect(c.label).toBe('Bought 3 cards for 10.00')
    expect(s.items).toHaveLength(1)
    const lots = s.lots.filter((l) => l.source === 'trade-in')
    expect(lots.reduce((n, l) => n + l.qty * l.unitCostCents!, 0)).toBe(1000)
    expect(lots.reduce((n, l) => n + l.qty, 0)).toBe(3)
    const row = buildInventory(s, undefined, 6_000)[0]!
    expect(row).toMatchObject({ qty: 3, knownCostCents: 1000 })
    expect(row.item.profileId).toBe('p2')
    expect(s.sales[0]!.lines).toEqual([])

    applyOps(s, c.inverse!(ctx('p1', 7_000)))
    expect(buildInventory(s, undefined, 8_000)).toHaveLength(0)
  })

  it('a trade moves stock both ways in one write', async () => {
    const { dealToDraft } = await import('../domain/deal')
    const s = empty()
    applyOps(s, createItem(ctx(), { profileId: 'p1', name: 'Charizard', marketPriceCents: 8000 }, { qty: 1, unitCostCents: 5000 }).ops)
    const charizard = s.items[0]!
    applyOps(s, recordSale(ctx('p1', 5_000), dealToDraft({
      by: 'p1', cashCents: 2000, method: 'cash',
      out: [{ itemId: charizard.id, ownerProfileId: 'p1', qty: 1, stickerPriceCents: 8800 }],
      incoming: [{ itemId: null, ownerProfileId: 'p1', name: 'Pikachu', cardNumber: '', qty: 1, worthCents: 7000 }],
    })).ops)
    const rows = buildInventory(s, undefined, 6_000)
    expect(rows.find((r) => r.item.id === charizard.id)!.qty).toBe(0)
    const pika = rows.find((r) => r.item.name === 'Pikachu')!
    expect(pika).toMatchObject({ qty: 1, knownCostCents: 6800 })
    expect(pika.item.marketPriceCents).toBe(7000)
  })
})
