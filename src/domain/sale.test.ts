import { describe, expect, it } from 'vitest'
import { quickSale, saleTotals, validateSale, type SaleDraft } from './sale'
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
