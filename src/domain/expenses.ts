import { allocate } from './show'
import type { ProfileId } from './sale'

export const EXPENSE_CATEGORIES = ['Table fee', 'Travel', 'Food', 'Supplies', 'Postage', 'Other'] as const

export interface ExpenseLike {
  description: string
  category?: string
  amountCents: number
  paidByProfileId: ProfileId
  /** Percentage of the expense each person bears. */
  splitPct: Record<ProfileId, number>
  deletedAt: number | null
  settledAt?: number | null
}

/** Older expenses have no category: the show's table fee is recognised by its description. */
export function categoryOf(e: Pick<ExpenseLike, 'description' | 'category'>): string {
  if (e.category) return e.category
  return e.description.trim().toLowerCase() === 'table fee' ? 'Table fee' : 'Other'
}

export interface ExpenseBalance {
  totalCents: number
  paidCents: Record<ProfileId, number>
  shareCents: Record<ProfileId, number>
  /** What each person paid minus their share: positive means they are owed money. */
  netCents: Record<ProfileId, number>
  /** Who pays whom to even up; null when nobody owes anything. */
  settlement: { from: ProfileId; to: ProfileId; amountCents: number } | null
}

/**
 * Splits the given expenses between the two people. Deleted expenses are ignored; pass only the
 * unsettled ones to get what is still owed.
 */
export function expenseBalance(expenses: ExpenseLike[]): ExpenseBalance {
  const paid: Record<ProfileId, number> = { p1: 0, p2: 0 }
  const share: Record<ProfileId, number> = { p1: 0, p2: 0 }
  let total = 0
  for (const e of expenses) {
    if (e.deletedAt) continue
    total += e.amountCents
    paid[e.paidByProfileId] += e.amountCents
    const [a = 0, b = 0] = allocate(e.amountCents, [e.splitPct.p1 ?? 0, e.splitPct.p2 ?? 0])
    share.p1 += a
    share.p2 += b
  }
  const net = { p1: paid.p1 - share.p1, p2: paid.p2 - share.p2 }
  const settlement = net.p1 === 0 ? null : net.p1 > 0 ? { from: 'p2' as const, to: 'p1' as const, amountCents: net.p1 } : { from: 'p1' as const, to: 'p2' as const, amountCents: -net.p1 }
  return { totalCents: total, paidCents: paid, shareCents: share, netCents: net, settlement }
}

/** Local calendar day as YYYY-MM-DD. */
export function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
