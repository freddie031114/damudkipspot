import { describe, expect, it } from 'vitest'
import { categoryOf, expenseBalance, isoDay, type ExpenseLike } from './expenses'

const exp = (amountCents: number, paidByProfileId: 'p1' | 'p2', p1 = 50, extra: Partial<ExpenseLike> = {}): ExpenseLike =>
  ({ description: 'x', amountCents, paidByProfileId, splitPct: { p1, p2: 100 - p1 }, deletedAt: null, ...extra })

describe('expenseBalance', () => {
  it('splits an expense one person paid evenly', () => {
    const b = expenseBalance([exp(12000, 'p1')])
    expect(b.totalCents).toBe(12000)
    expect(b.shareCents).toEqual({ p1: 6000, p2: 6000 })
    expect(b.settlement).toEqual({ from: 'p2', to: 'p1', amountCents: 6000 })
  })

  it('nets off what each person paid', () => {
    const b = expenseBalance([exp(12000, 'p1'), exp(8000, 'p2')])
    expect(b.paidCents).toEqual({ p1: 12000, p2: 8000 })
    expect(b.settlement).toEqual({ from: 'p2', to: 'p1', amountCents: 2000 })
  })

  it('is square when each paid their own share', () => {
    expect(expenseBalance([exp(5000, 'p1', 100), exp(3000, 'p2', 0)]).settlement).toBeNull()
  })

  it('honours a custom split exactly, with odd cents', () => {
    const b = expenseBalance([exp(1001, 'p2', 30)])
    expect(b.shareCents.p1 + b.shareCents.p2).toBe(1001)
    expect(b.settlement?.to).toBe('p2')
  })

  it('ignores deleted expenses', () => {
    expect(expenseBalance([exp(9999, 'p1', 50, { deletedAt: 5 })]).totalCents).toBe(0)
  })

  it('an expense only one person benefits from is owed in full by them', () => {
    // Ferrell paid $40 for stuff that is 100% Freddie's
    expect(expenseBalance([exp(4000, 'p2', 100)]).settlement).toEqual({ from: 'p1', to: 'p2', amountCents: 4000 })
  })
})

describe('categoryOf', () => {
  it('uses the saved category, and recognises old table fees', () => {
    expect(categoryOf({ description: 'Parking', category: 'Travel' })).toBe('Travel')
    expect(categoryOf({ description: 'Table fee' })).toBe('Table fee')
    expect(categoryOf({ description: 'Lunch' })).toBe('Other')
  })
})

describe('isoDay', () => {
  it('formats a local date', () => expect(isoDay(new Date(2026, 10, 9, 15).getTime())).toBe('2026-11-09'))
})
