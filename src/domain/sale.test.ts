import { describe, expect, it } from 'vitest'
import { quickSale, saleTotals, settlePayments, tradeCreditCents, validateSale, type SaleDraft, type TradeInInput } from './sale'
import { stickerFromMarket } from './sticker'

const base = { soldByProfileId: 'p1' as const, itemId: 'A', ownerProfileId: 'p2' as const, method: 'cash' as const }

describe('quick sale', () => {
  it('pre-fills the price from the sticker and balances the payment', () => {
    const sticker = stickerFromMarket(3500) // $39
    const sale = quickSale({ ...base, stickerPriceCents: sticker })
    expect(sale.lines[0]?.unitPriceCents).toBe(3900)
    expect(saleTotals(sale)).toMatchObject({ totalCents: 3900, paidCents: 3900 })
    expect(validateSale(sale)).toEqual([])
  })

  it('records the edited price and the original sticker (discount is visible later)', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 3900, priceCents: 3500, qty: 2 })
    expect(sale.lines[0]).toMatchObject({ stickerPriceCents: 3900, unitPriceCents: 3500, qty: 2 })
    expect(saleTotals(sale).totalCents).toBe(7000)
    expect(validateSale(sale)).toEqual([])
  })

  it('records the seller separately from the stock owner', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 1000 })
    expect(sale.soldByProfileId).toBe('p1')
    expect(sale.lines[0]?.ownerProfileId).toBe('p2')
  })
})

describe('validateSale', () => {
  it('supports a bundle discount and split payments', () => {
    const sale: SaleDraft = {
      soldByProfileId: 'p1', discountCents: 500,
      lines: [
        { itemId: 'A', ownerProfileId: 'p1', qty: 1, stickerPriceCents: 3000, unitPriceCents: 3000 },
        { itemId: 'B', ownerProfileId: 'p2', qty: 1, stickerPriceCents: 2000, unitPriceCents: 2000 },
      ],
      payments: [
        { method: 'cash', amountCents: 2000, receivedByProfileId: 'p1' },
        { method: 'payid', amountCents: 2500, receivedByProfileId: 'p1' },
      ],
    }
    expect(saleTotals(sale).totalCents).toBe(4500)
    expect(validateSale(sale)).toEqual([])
  })

  it('rejects bad quantities, negative prices, unbalanced payments and unknown profiles', () => {
    const bad = quickSale({ ...base, stickerPriceCents: 1000 })
    bad.lines[0]!.qty = 0
    bad.lines[0]!.unitPriceCents = -1
    bad.payments[0]!.amountCents = 5
    bad.soldByProfileId = 'zz' as never
    const errors = validateSale(bad)
    expect(errors).toEqual(
      expect.arrayContaining([
        'Unknown seller',
        'Line 1: quantity must be a whole number of at least 1',
        'Line 1: price must be zero or more',
        'Payments must add up to the sale total',
      ]),
    )
  })

  it('rejects an empty sale and a discount bigger than the sale', () => {
    expect(validateSale({ soldByProfileId: 'p1', lines: [], payments: [], discountCents: 0 })).toContain('Add at least one item')
    const s = quickSale({ ...base, stickerPriceCents: 1000 })
    s.discountCents = 5000
    expect(validateSale(s)).toContain('Discount is larger than the sale')
  })
})

describe('trades', () => {
  const card = (qty: number, creditCents: number): TradeInInput => ({ itemId: 'T', ownerProfileId: 'p1', qty, creditCents })

  it('totals the credit given for the cards received', () => {
    expect(tradeCreditCents([card(2, 1500), card(1, 500)])).toBe(3500)
    expect(tradeCreditCents(undefined)).toBe(0)
  })

  it('pays the balance by the chosen method after the trade credit', () => {
    expect(settlePayments({ totalCents: 5000, creditCents: 3000, method: 'cash', receivedBy: 'p1' })).toEqual([
      { method: 'trade', amountCents: 3000, receivedByProfileId: 'p1' },
      { method: 'cash', amountCents: 2000, receivedByProfileId: 'p1' },
    ])
  })

  it('an even swap has only the trade payment', () => {
    expect(settlePayments({ totalCents: 3000, creditCents: 3000, method: 'cash', receivedBy: 'p1' })).toEqual([
      { method: 'trade', amountCents: 3000, receivedByProfileId: 'p1' },
    ])
  })

  it('gives cash back when the cards received are worth more than the sale', () => {
    const p = settlePayments({ totalCents: 8000, creditCents: 10000, method: 'card', receivedBy: 'p2' })
    expect(p).toEqual([
      { method: 'trade', amountCents: 10000, receivedByProfileId: 'p2' },
      { method: 'cash', amountCents: -2000, receivedByProfileId: 'p2' },
    ])
  })

  it('a sale with cards traded in and a cash top-up is valid', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 5000, method: 'cash', tradeIns: [card(1, 3000)] })
    expect(sale.payments.map((p) => [p.method, p.amountCents])).toEqual([['trade', 3000], ['cash', 2000]])
    expect(validateSale(sale)).toEqual([])
  })

  it('a sale with cash back to the customer is valid', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 8000, method: 'cash', tradeIns: [card(1, 10000)] })
    expect(sale.payments.at(-1)).toMatchObject({ method: 'cash', amountCents: -2000 })
    expect(validateSale(sale)).toEqual([])
  })

  it('refuses a negative payment when no cards were traded in', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 1000 })
    sale.payments = [{ method: 'cash', amountCents: 1500, receivedByProfileId: 'p1' }, { method: 'cash', amountCents: -500, receivedByProfileId: 'p1' }]
    expect(validateSale(sale)).toContain('Payment 2: amount must be zero or more')
  })

  it('rejects a trade payment that does not match the cards received', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 5000, method: 'cash', tradeIns: [card(1, 3000)] })
    sale.payments = [{ method: 'trade', amountCents: 1000, receivedByProfileId: 'p1' }, { method: 'cash', amountCents: 4000, receivedByProfileId: 'p1' }]
    expect(validateSale(sale)).toContain('Trade credit must equal the value of the cards received')
  })

  it('rejects bad trade-in quantities, credit and unnamed new cards', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 1000, method: 'cash', tradeIns: [{ itemId: null, ownerProfileId: 'p1', qty: 0, creditCents: -1 }] })
    expect(validateSale(sale)).toEqual(expect.arrayContaining([
      'Trade-in 1: quantity must be a whole number of at least 1',
      'Trade-in 1: credit must be zero or more',
      'Trade-in 1: name the card',
    ]))
  })
})

describe('deals that are not plain sales', () => {
  it('allows a sale with no lines when cards came in (a buy)', () => {
    const buy: SaleDraft = {
      soldByProfileId: 'p1', lines: [], discountCents: 0,
      tradeIns: [{ itemId: 'T', ownerProfileId: 'p1', qty: 2, creditCents: 500 }],
      payments: [{ method: 'trade', amountCents: 1000, receivedByProfileId: 'p1' }, { method: 'cash', amountCents: -1000, receivedByProfileId: 'p1' }],
    }
    expect(validateSale(buy)).toEqual([])
  })
  it('a buy still has to balance', () => {
    const buy: SaleDraft = {
      soldByProfileId: 'p1', lines: [], discountCents: 0,
      tradeIns: [{ itemId: 'T', ownerProfileId: 'p1', qty: 2, creditCents: 500 }],
      payments: [{ method: 'trade', amountCents: 1000, receivedByProfileId: 'p1' }],
    }
    expect(validateSale(buy)).toContain('Payments must add up to the sale total')
  })
  it('a lump credit for several cards is checked as a whole', () => {
    const d: SaleDraft = {
      soldByProfileId: 'p1', lines: [], discountCents: 0,
      tradeIns: [{ itemId: 'T', ownerProfileId: 'p1', qty: 3, creditCents: 333, totalCreditCents: 1000 }],
      payments: [{ method: 'trade', amountCents: 1000, receivedByProfileId: 'p1' }, { method: 'cash', amountCents: -1000, receivedByProfileId: 'p1' }],
    }
    expect(validateSale(d)).toEqual([])
  })
  it('selling above sticker shows as a negative discount', () => {
    const sale = quickSale({ ...base, stickerPriceCents: 1000 })
    sale.discountCents = -200
    sale.payments[0]!.amountCents = 1200
    expect(validateSale(sale)).toEqual([])
  })
})
