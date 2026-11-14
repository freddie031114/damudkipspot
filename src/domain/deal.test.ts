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
