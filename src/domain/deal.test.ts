import { describe, expect, it } from 'vitest'
import { cashLabel, dealNumbers, dealToDraft, summarizeDeal, type DealIn, type DealInput, type DealOut } from './deal'
import { saleTotals, tradeInputCreditCents, validateSale } from './sale'

const out = (sticker: number, qty = 1, owner: 'p1' | 'p2' = 'p1', itemId = 'A'): DealOut => ({ itemId, ownerProfileId: owner, qty, stickerPriceCents: sticker })
const inn = (name: string, qty = 1, worth: number | null = null, itemId: string | null = null): DealIn => ({ itemId, ownerProfileId: 'p1', name, cardNumber: '', qty, worthCents: worth })
const deal = (over: Partial<DealInput>): DealInput => ({ by: 'p1', out: [], incoming: [], cashCents: 0, method: 'cash', ...over })
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`

describe('dealNumbers', () => {
  it('a plain sale is worth the cash received, whatever the stickers say', () => {
    expect(dealNumbers(deal({ out: [out(5000), out(3000)], cashCents: 7000 }))).toEqual({ stickerCents: 8000, revenueCents: 7000, tradeValueCents: 0 })
  })
  it('an even swap values the cards coming in at the sticker value of the cards going out', () => {
    expect(dealNumbers(deal({ out: [out(10000)], incoming: [inn('X')] }))).toEqual({ stickerCents: 10000, revenueCents: 10000, tradeValueCents: 10000 })
  })
  it('cash the customer adds lowers what their cards cost us', () => {
    expect(dealNumbers(deal({ out: [out(10000)], incoming: [inn('X')], cashCents: 2000 })).tradeValueCents).toBe(8000)
  })
  it('cash we add raises what their cards cost us', () => {
    expect(dealNumbers(deal({ out: [out(5000)], incoming: [inn('X')], cashCents: -3000 })).tradeValueCents).toBe(8000)
  })
  it('a buy costs the cash paid', () => {
    expect(dealNumbers(deal({ incoming: [inn('X', 3)], cashCents: -4000 }))).toEqual({ stickerCents: 0, revenueCents: 0, tradeValueCents: 4000 })
  })
  it('refuses deals that make no sense', () => {
    expect(() => dealNumbers(deal({}))).toThrow('Add the cards')
    expect(() => dealNumbers(deal({ out: [out(1000)], cashCents: -500 }))).toThrow('got no cards')
    expect(() => dealNumbers(deal({ incoming: [inn('X')], cashCents: 500 }))).toThrow('nothing went out')
  })
})

describe('dealToDraft', () => {
  it('a sale below sticker: one cash payment, stickers kept for reference', () => {
    const d = dealToDraft(deal({ out: [out(5000), out(3000, 1, 'p2', 'B')], cashCents: 7000, method: 'payid' }))
    expect(validateSale(d)).toEqual([])
    expect(saleTotals(d).totalCents).toBe(7000)
    expect(d.payments).toEqual([{ method: 'payid', amountCents: 7000, receivedByProfileId: 'p1' }])
    expect(d.lines.map((l) => l.stickerPriceCents)).toEqual([5000, 3000])
    expect(d.tradeIns).toBeUndefined()
  })

  it('a sale above sticker is valid too', () => {
    const d = dealToDraft(deal({ out: [out(5000)], cashCents: 6000 }))
    expect(validateSale(d)).toEqual([])
    expect(d.discountCents).toBe(-1000)
    expect(saleTotals(d).totalCents).toBe(6000)
  })

  it('a trade with cash from the customer balances: trade credit plus cash equals the value out', () => {
    const d = dealToDraft(deal({ out: [out(10000)], incoming: [inn('Eevee', 2)], cashCents: 2000 }))
    expect(validateSale(d)).toEqual([])
    expect(d.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 8000], ['cash', 2000]])
    expect(tradeInputCreditCents(d.tradeIns![0]!)).toBe(8000)
  })

  it('a trade where we add cash records the cash going out', () => {
    const d = dealToDraft(deal({ out: [out(5000)], incoming: [inn('Gengar')], cashCents: -3000, method: 'card' }))
    expect(validateSale(d)).toEqual([])
    expect(d.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 8000], ['cash', -3000]])
  })

  it('a buy has no lines and nets to zero', () => {
    const d = dealToDraft(deal({ incoming: [inn('A', 2), inn('B', 1)], cashCents: -4000 }))
    expect(validateSale(d)).toEqual([])
    expect(d.lines).toEqual([])
    expect(saleTotals(d).totalCents).toBe(0)
    expect(d.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 4000], ['cash', -4000]])
  })

  it('shares the cost evenly per card when no worth is given, to the exact cent', () => {
    const d = dealToDraft(deal({ incoming: [inn('A', 2), inn('B', 1)], cashCents: -1000 }))
    const credits = d.tradeIns!.map(tradeInputCreditCents)
    expect(credits.reduce((a, b) => a + b, 0)).toBe(1000)
    expect(credits).toEqual([667, 333])
  })

  it('shares the cost by worth when every card has one, and uses it as the market price', () => {
    const d = dealToDraft(deal({ incoming: [inn('Big', 1, 9000), inn('Small', 1, 1000)], cashCents: -5000 }))
    expect(d.tradeIns!.map(tradeInputCreditCents)).toEqual([4500, 500])
    expect(d.tradeIns![0]!.item!.marketPriceCents).toBe(9000)
  })

  it('cards that join existing stock carry no new-item details', () => {
    const d = dealToDraft(deal({ out: [out(2000)], incoming: [inn('Pikachu', 1, null, 'P')] }))
    expect(d.tradeIns![0]).toMatchObject({ itemId: 'P' })
    expect(d.tradeIns![0]!.item).toBeUndefined()
  })

  it('unpriced stock still shares the money between the cards', () => {
    const d = dealToDraft(deal({ out: [out(0), out(0, 1, 'p1', 'B')], cashCents: 1000 }))
    expect(validateSale(d)).toEqual([])
    expect(saleTotals(d).totalCents).toBe(1000)
    expect(d.lines.every((l) => l.unitPriceCents > 0)).toBe(true)
  })

  it('a free giveaway and a free pickup are both allowed', () => {
    expect(validateSale(dealToDraft(deal({ out: [out(500)], cashCents: 0 })))).toEqual([])
    expect(validateSale(dealToDraft(deal({ incoming: [inn('Found')], cashCents: 0 })))).toEqual([])
  })

  it('rejects unnamed cards and bad quantities', () => {
    expect(() => dealToDraft(deal({ incoming: [inn(' ')], cashCents: -100 }))).toThrow('Name each card')
    expect(() => dealToDraft(deal({ out: [out(100, 0)], cashCents: 100 }))).toThrow('Quantities')
  })
})

describe('summarizeDeal', () => {
  const known = (c: number) => () => ({ knownCostCents: c, unknownCostQty: 0, oversoldQty: 0 })
  const saved = (d: ReturnType<typeof dealToDraft>) => ({
    id: 's', discountCents: d.discountCents, lines: d.lines, payments: d.payments, voidedAt: null,
    tradeIns: (d.tradeIns ?? []).map((t) => ({ itemId: 'n', ownerProfileId: t.ownerProfileId, qty: t.qty, creditCents: t.creditCents, lotId: 'l', createdItem: true })),
  })
  it('a sale: cash in, profit against cost', () => {
    const s = summarizeDeal(saved(dealToDraft(deal({ out: [out(5000, 2)], cashCents: 9000 }))), known(4000))
    expect(s).toMatchObject({ kind: 'sale', outUnits: 2, inUnits: 0, cashCents: 9000, revenueCents: 9000, profitCents: 5000 })
  })
  it('a trade: counts cards both ways and the cash', () => {
    const s = summarizeDeal(saved(dealToDraft(deal({ out: [out(10000)], incoming: [inn('X', 3)], cashCents: -2000 }))), known(6000))
    expect(s).toMatchObject({ kind: 'trade', outUnits: 1, inUnits: 3, cashCents: -2000, tradeValueCents: 12000, revenueCents: 10000, profitCents: 4000 })
  })
  it('a buy has no profit yet', () => {
    const s = summarizeDeal(saved(dealToDraft(deal({ incoming: [inn('X', 2)], cashCents: -3000 }))), known(0))
    expect(s).toMatchObject({ kind: 'buy', outUnits: 0, inUnits: 2, cashCents: -3000, profitCents: null })
  })
  it('profit is unknown when the stock sold has no recorded cost', () => {
    const s = summarizeDeal(saved(dealToDraft(deal({ out: [out(5000)], cashCents: 5000 }))), () => ({ knownCostCents: 0, unknownCostQty: 1, oversoldQty: 0 }))
    expect(s.profitCents).toBeNull()
  })
})

describe('cashLabel', () => {
  it('shows the direction of the money', () => {
    expect(cashLabel(2000, fmt)).toBe('+$20.00')
    expect(cashLabel(-3000, fmt)).toBe('−$30.00')
    expect(cashLabel(0, fmt)).toBe('No cash')
  })
})

import { quickDealToDraft, quickNumbers, solveQuick, type QuickDealInput } from './deal'

describe('solveQuick (cards out = cards in + cash)', () => {
  const t = (o: number, i: number, c: number) => ({ outCents: o, inCents: i, cashCents: c })
  it('works out the cash from the two card values', () => {
    expect(solveQuick({ out: 10000, in: 8000 }, ['out', 'in'])).toMatchObject({ ...t(10000, 8000, 2000), calculated: 'cash' })
    expect(solveQuick({ out: 5000, in: 8000 }, ['out', 'in'])).toMatchObject(t(5000, 8000, -3000))
  })
  it('works out what came in from what went out and the cash', () => {
    expect(solveQuick({ out: 10000, cash: 2000 }, ['out', 'cash'])).toMatchObject({ ...t(10000, 8000, 2000), calculated: 'in' })
    expect(solveQuick({ out: 5000, cash: -3000 }, ['out', 'cash'])).toMatchObject(t(5000, 8000, -3000))
  })
  it('works out what went out from what came in and the cash', () => {
    expect(solveQuick({ in: 8000, cash: 2000 }, ['in', 'cash'])).toMatchObject({ ...t(10000, 8000, 2000), calculated: 'out' })
  })
  it('only the last two typed boxes count, so typing a third recalculates the oldest', () => {
    // out typed first, then cash, then in: out becomes the calculated one
    expect(solveQuick({ out: 99999, in: 8000, cash: 2000 }, ['out', 'cash', 'in'])).toMatchObject({ ...t(10000, 8000, 2000), calculated: 'out' })
  })
  it('one box alone gives a sale (out), a buy (in) or either (cash)', () => {
    expect(solveQuick({ out: 7000 }, ['out'])).toMatchObject(t(7000, 0, 7000))
    expect(solveQuick({ in: 4000 }, ['in'])).toMatchObject(t(0, 4000, -4000))
    expect(solveQuick({ cash: 3000 }, ['cash'])).toMatchObject(t(3000, 0, 3000))
    expect(solveQuick({ cash: -3000 }, ['cash'])).toMatchObject(t(0, 3000, -3000))
    expect(solveQuick({}, [])).toMatchObject(t(0, 0, 0))
  })
  it('never goes negative: cash above the value out, or a buy typed as in + cash', () => {
    expect(solveQuick({ out: 5000, cash: 8000 }, ['out', 'cash']).inCents).toBe(0)
    expect(solveQuick({ in: 4000, cash: -9000 }, ['in', 'cash']).outCents).toBe(0)
  })
})

describe('quickDealToDraft', () => {
  const base: Omit<QuickDealInput, 'totals'> = { by: 'p1', picks: [], method: 'cash', stockOf: 'p1', lot: { label: '', count: 1 } }
  const q = (o: number, i: number, c: number, extra: Partial<QuickDealInput> = {}) => quickDealToDraft({ ...base, totals: { outCents: o, inCents: i, cashCents: c }, ...extra })

  it('a sale by value: cash in, cards out carried against bulk, no lot made', () => {
    const d = q(10000, 0, 8000)
    expect(validateSale(d)).toEqual([])
    expect(d.looseOut).toEqual({ ownerProfileId: 'p1', valueCents: 10000 })
    expect(d.lines).toEqual([])
    expect(d.tradeIns).toBeUndefined()
    expect(saleTotals(d).totalCents).toBe(8000)
    expect(d.payments).toEqual([{ method: 'cash', amountCents: 8000, receivedByProfileId: 'p1' }])
  })

  it('a trade by value: one lot comes in at its value, the cash makes up the rest', () => {
    const d = q(10000, 8000, 2000, { lot: { label: "Dan's binder", count: 40 } })
    expect(validateSale(d)).toEqual([])
    expect(d.looseOut!.valueCents).toBe(10000)
    expect(saleTotals(d).totalCents).toBe(10000)
    expect(d.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 8000], ['cash', 2000]])
    expect(d.tradeIns).toHaveLength(1)
    expect(d.tradeIns![0]).toMatchObject({ itemId: null, qty: 40, totalCreditCents: 8000 })
    expect(d.tradeIns![0]!.item).toMatchObject({ name: "Dan's binder", marketPriceCents: 200 })
  })

  it('a trade where we add cash', () => {
    const d = q(5000, 8000, -3000)
    expect(validateSale(d)).toEqual([])
    expect(d.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 8000], ['cash', -3000]])
    expect(d.tradeIns![0]!.item!.name).toBe('Trade lot')
  })

  it('a straight swap with no cash', () => {
    const d = q(6000, 6000, 0)
    expect(validateSale(d)).toEqual([])
    expect(d.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 6000]])
  })

  it('a buy costs what was paid, even when the cards are worth more', () => {
    const d = q(0, 10000, -4000)
    expect(validateSale(d)).toEqual([])
    expect(d.lines).toEqual([])
    expect(d.looseOut).toBeUndefined()
    expect(saleTotals(d).totalCents).toBe(0)
    expect(d.tradeIns![0]).toMatchObject({ totalCreditCents: 4000 })
    expect(d.tradeIns![0]!.item!.marketPriceCents).toBe(10000)
  })

  it('picked cards go out as lines, weighted by sticker, and the deal still adds up', () => {
    const d = q(10000, 3000, 7000, { picks: [{ itemId: 'A', ownerProfileId: 'p2', qty: 1, stickerPriceCents: 6000 }, { itemId: 'B', ownerProfileId: 'p2', qty: 1, stickerPriceCents: 4000 }] })
    expect(validateSale(d)).toEqual([])
    expect(d.looseOut).toBeUndefined()
    expect(saleTotals(d).totalCents).toBe(10000)
    expect(d.tradeIns![0]!.ownerProfileId).toBe('p2')
  })

  it('the cash can exceed the value given (sold above value)', () => {
    const d = q(5000, 0, 8000)
    expect(validateSale(d)).toEqual([])
    expect(saleTotals(d).totalCents).toBe(8000)
  })

  it('refuses nonsense', () => {
    expect(() => q(0, 0, 0)).toThrow('Enter what went out')
    expect(() => q(0, 0, 5000)).toThrow('nothing went out')
    expect(() => q(5000, 0, -2000)).toThrow('Check the value of the cards that came in')
    expect(() => q(0, 5000, -5000, { lot: { label: '', count: 0 } })).toThrow('How many cards')
  })

  it('quickNumbers: revenue is what came back, cost of a buy is the cash paid', () => {
    expect(quickNumbers({ outCents: 10000, inCents: 8000, cashCents: 2000 }, false)).toMatchObject({ revenueCents: 10000, tradeValueCents: 8000 })
    expect(quickNumbers({ outCents: 0, inCents: 9000, cashCents: -4000 }, false)).toMatchObject({ revenueCents: 0, tradeValueCents: 4000 })
  })
})

describe('profit and settlement with cards out by value', () => {
  const known = () => ({ knownCostCents: 0, unknownCostQty: 0, oversoldQty: 0 })
  const saved = (d: ReturnType<typeof quickDealToDraft>, id = 's') => ({
    id, discountCents: d.discountCents, lines: d.lines, payments: d.payments, voidedAt: null, looseOut: d.looseOut,
    tradeIns: (d.tradeIns ?? []).map((t) => ({ itemId: 'n', ownerProfileId: t.ownerProfileId, qty: t.qty, creditCents: t.creditCents, lotId: 'l', createdItem: true })),
  })
  const q = (o: number, i: number, c: number, stockOf: 'p1' | 'p2' = 'p1') => quickDealToDraft({ by: 'p1', picks: [], method: 'cash', stockOf, lot: { label: '', count: 1 }, totals: { outCents: o, inCents: i, cashCents: c } })

  it('summarizeDeal: a trade by value earns revenue minus the value given', () => {
    const s = summarizeDeal(saved(q(10000, 8000, 2000)), known)
    expect(s).toMatchObject({ kind: 'trade', cashCents: 2000, tradeValueCents: 8000, revenueCents: 10000, profitCents: 0 })
    const sale = summarizeDeal(saved(q(10000, 0, 12000)), known)
    expect(sale).toMatchObject({ kind: 'sale', revenueCents: 12000, profitCents: 2000 })
  })

  it('summarizeDeal: a buy has no profit yet', () => {
    expect(summarizeDeal(saved(q(0, 5000, -3000)), known)).toMatchObject({ kind: 'buy', cashCents: -3000, profitCents: null })
  })

  it('summarizeShow: revenue and profit go to the owner of the cards that went out', async () => {
    const { summarizeShow } = await import('./show')
    const r = summarizeShow({ sales: [saved(q(10000, 0, 12000, 'p2'))], expenses: [], participants: [], costOf: known })
    expect(r.perProfile.p2).toMatchObject({ revenueCents: 12000, knownCostCents: 10000, profitCents: 2000 })
    expect(r.perProfile.p1.revenueCents).toBe(0)
    // Freddie took the money for Ferrell's cards, so he owes it
    expect(r.settlement).toEqual({ from: 'p1', to: 'p2', amountCents: 12000 })
  })

  it('buildSalesLog: cards out by value are one row, carried at their value', async () => {
    const { buildSalesLog } = await import('./report')
    const d = saved(q(10000, 0, 12000))
    const rows = buildSalesLog({ sales: [{ ...d, soldAt: 1, soldByProfileId: 'p1', showId: null }], items: [], showName: () => '', costOf: known })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ itemName: 'Loose cards (by value)', owner: 'p1', revenueCents: 12000, costCents: 10000, profitCents: 2000 })
  })
})
