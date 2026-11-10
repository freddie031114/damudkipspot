import { describe, expect, it } from 'vitest'
import type { SaleLine, SalePayment } from './sale'
import { allocate, summarizeShow, type LineCost, type SummarySale } from './show'

const known = (c: number): LineCost => ({ knownCostCents: c, unknownCostQty: 0, oversoldQty: 0 })
const unknown: LineCost = { knownCostCents: 0, unknownCostQty: 1, oversoldQty: 0 }
const line = (owner: 'p1' | 'p2', price: number, qty = 1): SaleLine => ({ itemId: 'x', ownerProfileId: owner, qty, stickerPriceCents: price, unitPriceCents: price })
const pay = (method: SalePayment['method'], amount: number, by: 'p1' | 'p2'): SalePayment => ({ method, amountCents: amount, receivedByProfileId: by })
const sale = (id: string, lines: SaleLine[], payments: SalePayment[], discount = 0, voided = false): SummarySale =>
  ({ id, lines, payments, discountCents: discount, voidedAt: voided ? 1 : null })
const base = { expenses: [], participants: [] as never[], costOf: () => known(0) }

describe('allocate', () => {
  it('always adds up exactly', () => {
    for (const total of [0, 1, 99, 1000, 12345]) expect(allocate(total, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(total)
    expect(allocate(100, [1, 2])).toEqual([33, 67])
  })
  it('handles zero weights', () => expect(allocate(50, [0, 0])).toEqual([0, 0]))
})

describe('summarizeShow', () => {
  it('totals takings by payment method and ignores voided sales', () => {
    const r = summarizeShow({
      ...base,
      sales: [
        sale('a', [line('p1', 3000)], [pay('cash', 3000, 'p1')]),
        sale('b', [line('p2', 5000)], [pay('card', 5000, 'p1')]),
        sale('c', [line('p1', 9999)], [pay('cash', 9999, 'p1')], 0, true),
      ],
    })
    expect(r.salesCount).toBe(2)
    expect(r.totalCents).toBe(8000)
    expect(r.byMethod).toEqual({ cash: 3000, card: 5000, payid: 0, trade: 0 })
  })

  it('revenue and profit are per owner of the stock, not per seller', () => {
    const r = summarizeShow({
      ...base,
      sales: [sale('a', [line('p2', 4000)], [pay('cash', 4000, 'p1')])],
      costOf: () => known(1500),
    })
    expect(r.perProfile.p2.revenueCents).toBe(4000)
    expect(r.perProfile.p2.profitCents).toBe(2500)
    expect(r.perProfile.p1.revenueCents).toBe(0)
  })

  it('keeps unknown-cost sales out of profit but shows their revenue', () => {
    const r = summarizeShow({ ...base, sales: [sale('a', [line('p1', 2000)], [pay('cash', 2000, 'p1')])], costOf: () => unknown })
    expect(r.perProfile.p1).toMatchObject({ revenueCents: 2000, unknownCostRevenueCents: 2000, profitCents: 0 })
  })

  it('spreads a bundle discount across lines so revenue still adds up', () => {
    const r = summarizeShow({
      ...base,
      sales: [sale('a', [line('p1', 3000), line('p2', 2000)], [pay('cash', 4500, 'p1')], 500)],
    })
    expect(r.totalCents).toBe(4500)
    expect(r.perProfile.p1.revenueCents + r.perProfile.p2.revenueCents).toBe(4500)
    expect(r.perProfile.p1.revenueCents).toBe(2700)
    expect(r.perProfile.p2.revenueCents).toBe(1800)
  })

  it('settlement: money one person collected for the other is paid back', () => {
    // Freddie (p1) rang up and took the cash for Ferrell's (p2) card.
    const r = summarizeShow({ ...base, sales: [sale('a', [line('p2', 6000)], [pay('cash', 6000, 'p1')])] })
    expect(r.settlement).toEqual({ from: 'p1', to: 'p2', amountCents: 6000 })
  })

  it('settlement is nil when each person took the money for their own stock', () => {
    const r = summarizeShow({
      ...base,
      sales: [sale('a', [line('p1', 1000)], [pay('cash', 1000, 'p1')]), sale('b', [line('p2', 1000)], [pay('payid', 1000, 'p2')])],
    })
    expect(r.settlement).toBeNull()
  })

  it('splits expenses equally and adjusts the settlement for who paid', () => {
    // p1 paid the whole $100 table fee, split 50/50: p2 owes p1 $50.
    const r = summarizeShow({
      ...base,
      sales: [],
      expenses: [{ amountCents: 10000, paidByProfileId: 'p1', splitPct: { p1: 50, p2: 50 }, deletedAt: null }],
    })
    expect(r.expensesTotalCents).toBe(10000)
    expect(r.perProfile.p1.expenseShareCents).toBe(5000)
    expect(r.perProfile.p2.expenseShareCents).toBe(5000)
    expect(r.settlement).toEqual({ from: 'p2', to: 'p1', amountCents: 5000 })
  })

  it('combines sales and expenses into one settlement', () => {
    // p1 holds $60 of p2's money and paid the $100 fee. p2 owes p1 50, p1 owes p2 60 -> p1 pays p2 $10.
    const r = summarizeShow({
      ...base,
      sales: [sale('a', [line('p2', 6000)], [pay('cash', 6000, 'p1')])],
      expenses: [{ amountCents: 10000, paidByProfileId: 'p1', splitPct: { p1: 50, p2: 50 }, deletedAt: null }],
    })
    expect(r.settlement).toEqual({ from: 'p1', to: 'p2', amountCents: 1000 })
  })

  it('ignores deleted expenses and gives uneven splits exactly', () => {
    const r = summarizeShow({
      ...base,
      sales: [],
      expenses: [
        { amountCents: 999, paidByProfileId: 'p1', splitPct: { p1: 50, p2: 50 }, deletedAt: 5 },
        { amountCents: 1001, paidByProfileId: 'p2', splitPct: { p1: 50, p2: 50 }, deletedAt: null },
      ],
    })
    expect(r.expensesTotalCents).toBe(1001)
    expect(r.perProfile.p1.expenseShareCents + r.perProfile.p2.expenseShareCents).toBe(1001)
  })

  it('trade payments are not money: nothing to settle, no cash collected', () => {
    const r = summarizeShow({ ...base, sales: [sale('a', [line('p2', 5000)], [pay('trade', 5000, 'p1')])] })
    expect(r.settlement).toBeNull()
    expect(r.perProfile.p1.collectedCents).toBe(0)
    expect(r.perProfile.p2.revenueCents).toBe(5000)
  })

  it('reconciles cash against the float', () => {
    const r = summarizeShow({
      ...base,
      sales: [sale('a', [line('p1', 3000)], [pay('cash', 3000, 'p1')]), sale('b', [line('p1', 2000)], [pay('card', 2000, 'p1')])],
      participants: [{ profileId: 'p1', openingFloatCents: 10000, closingCashCents: 12900 }],
    })
    expect(r.perProfile.p1.expectedCashCents).toBe(13000)
    expect(r.perProfile.p1.cashDifferenceCents).toBe(-100)
    expect(r.perProfile.p2.cashDifferenceCents).toBeNull()
  })
})
