import { describe, expect, it } from 'vitest'
import { quickSale } from '../domain/sale'
import { summarizeShow } from '../domain/show'
import {
  addExpense, createItem, createShow, deleteExpense, deleteLot, recordSale, setParticipant, updateLot, updateSettings, updateShow,
} from './changes'
import { buildInventory, saleLineCosts, settingsFor } from './derive'
import { memorySource } from './memorySource'

let n = 0
const ctx = (actor: 'p1' | 'p2' = 'p1', now = 1000) => ({ actor, now, newId: () => `id${++n}` })

describe('shows', () => {
  it('creating a show with a table fee records it as an expense split 50/50', async () => {
    const src = memorySource()
    const c = createShow(ctx(), { name: 'Brisbane Card Show', startsOn: '2026-12-05', endsOn: '2026-12-05', venue: 'Convention Centre', tableFeeCents: 12000 })
    await src.commit(c.ops)
    const show = src.data.shows[0]!
    expect(show).toMatchObject({ name: 'Brisbane Card Show', status: 'planned', tableFeeCents: 12000 })
    expect(src.data.showExpenses).toHaveLength(1)
    expect(src.data.showExpenses[0]).toMatchObject({ description: 'Table fee', amountCents: 12000, paidByProfileId: 'p1', splitPct: { p1: 50, p2: 50 } })
    expect(show.feeExpenseId).toBe(src.data.showExpenses[0]!.id)
  })

  it('validates names, fees and dates', () => {
    expect(() => createShow(ctx(), { name: ' ', startsOn: '', endsOn: '', venue: '', tableFeeCents: 0 })).toThrow('Name the show')
    expect(() => createShow(ctx(), { name: 'x', startsOn: '', endsOn: '', venue: '', tableFeeCents: -1 })).toThrow('Table fee')
    expect(() => createShow(ctx(), { name: 'x', startsOn: '2026-12-06', endsOn: '2026-12-05', venue: '', tableFeeCents: 0 })).toThrow('cannot end')
  })

  it('changing the fee updates the same expense, not a second one', async () => {
    const src = memorySource()
    await src.commit(createShow(ctx(), { name: 'S', startsOn: '', endsOn: '', venue: '', tableFeeCents: 10000 }).ops)
    await src.commit(updateShow(ctx(), src.data.shows[0]!, { tableFeeCents: 15000 })!.ops)
    expect(src.data.showExpenses).toHaveLength(1)
    expect(src.data.showExpenses[0]!.amountCents).toBe(15000)
  })

  it('records float and cash count, and validates expenses', async () => {
    const src = memorySource()
    await src.commit(createShow(ctx(), { name: 'S', startsOn: '', endsOn: '', venue: '', tableFeeCents: 0 }).ops)
    await src.commit(setParticipant(ctx(), src.data.shows[0]!, 'p2', { openingFloatCents: 20000 }).ops)
    expect(src.data.shows[0]!.participants.find((p) => p.profileId === 'p2')!.openingFloatCents).toBe(20000)
    expect(() => addExpense(ctx(), 's', { description: 'Parking', amountCents: 0, paidBy: 'p1' })).toThrow('more than zero')
    expect(() => addExpense(ctx(), 's', { description: 'Parking', amountCents: 500, paidBy: 'p1', splitPct: { p1: 60, p2: 60 } })).toThrow('100%')
  })

  it('a whole show settles correctly end to end', async () => {
    const src = memorySource()
    const show = createShow(ctx('p1'), { name: 'S', startsOn: '', endsOn: '', venue: '', tableFeeCents: 10000 })
    await src.commit(show.ops)
    // Ferrell's card (cost $20) is sold for $60 by Freddie, who takes the cash.
    await src.commit(createItem(ctx('p2', 10), { profileId: 'p2', name: 'Gengar', marketPriceCents: 5000 }, { qty: 1, unitCostCents: 2000 }).ops)
    const item = src.data.items[0]!
    const sale = recordSale(ctx('p1', 20), quickSale({ soldByProfileId: 'p1', itemId: item.id, ownerProfileId: 'p2', stickerPriceCents: 5500, priceCents: 6000, method: 'cash' }), { showId: show.showId })
    await src.commit(sale.ops)
    const sum = summarizeShow({
      sales: src.data.sales.filter((s) => s.showId === show.showId),
      expenses: src.data.showExpenses,
      participants: src.data.shows[0]!.participants,
      costOf: saleLineCosts(src.data),
    })
    expect(sum.perProfile.p2).toMatchObject({ revenueCents: 6000, knownCostCents: 2000, profitCents: 4000, expenseShareCents: 5000, netProfitCents: -1000 })
    // Freddie holds $60 of Ferrell's money and paid the $100 fee (Ferrell's share is $50): Freddie owes $60 - $50 = $10.
    expect(sum.settlement).toEqual({ from: 'p1', to: 'p2', amountCents: 1000 })
  })

  it('expense removal is soft and undoable', async () => {
    const src = memorySource()
    const add = addExpense(ctx(), 'show1', { description: 'Parking', amountCents: 800, paidBy: 'p2' })
    await src.commit(add.ops)
    const e = src.data.showExpenses[0]!
    await src.commit(deleteExpense(ctx(), e).ops)
    expect(src.data.showExpenses[0]!.deletedAt).not.toBeNull()
    await src.commit(deleteExpense(ctx(), e).inverse!(ctx()))
    expect(src.data.showExpenses[0]!.deletedAt).toBeNull()
  })
})

describe('lot cost edits and settings', () => {
  it('adding a cost later changes the cost of goods on past sales', async () => {
    const src = memorySource()
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 1000 }, { qty: 1, unitCostCents: null, source: 'opening' }).ops)
    const item = src.data.items[0]!
    await src.commit(recordSale(ctx('p1', 50), quickSale({ soldByProfileId: 'p1', itemId: item.id, ownerProfileId: 'p1', stickerPriceCents: 1100, method: 'cash' })).ops)
    let cost = saleLineCosts(src.data)(src.data.sales[0]!.id, 0)
    expect(cost).toMatchObject({ unknownCostQty: 1, knownCostCents: 0 })
    await src.commit(updateLot(ctx(), src.data.lots[0]!, { unitCostCents: 400 }, 'A')!.ops)
    cost = saleLineCosts(src.data)(src.data.sales[0]!.id, 0)
    expect(cost).toMatchObject({ unknownCostQty: 0, knownCostCents: 400 })
  })

  it('rejects a bad lot edit and removes lots softly', async () => {
    const src = memorySource()
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 100 }, { qty: 2, unitCostCents: 10 }).ops)
    const lot = src.data.lots[0]!
    expect(() => updateLot(ctx(), lot, { qty: 0 })).toThrow()
    expect(updateLot(ctx(), lot, { qty: 2 })).toBeNull()
    await src.commit(deleteLot(ctx(), lot).ops)
    expect(buildInventory(src.data)[0]!.qty).toBe(0)
  })

  it('per-profile sticker settings apply to that profile only', async () => {
    const src = memorySource()
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 3500 }, { qty: 1, unitCostCents: null }).ops)
    await src.commit(createItem(ctx(), { profileId: 'p2', name: 'B', marketPriceCents: 3500 }, { qty: 1, unitCostCents: null }).ops)
    await src.commit(updateSettings(ctx(), { id: 'p1' }, { rounding: '5' }).ops)
    const rows = buildInventory(src.data, (p) => settingsFor(src.data.profiles, p))
    expect(rows.find((r) => r.item.name === 'A')!.sticker).toBe(4000)
    expect(rows.find((r) => r.item.name === 'B')!.sticker).toBe(3900)
    expect(() => updateSettings(ctx(), { id: 'p1' }, { multiplierPermille: 100 })).toThrow('between')
  })
})
