import type { PaymentMethod, ProfileId, SaleLine, SalePayment } from './sale'

/** Splits `total` across `weights` so the parts add up exactly (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0) return []
  if (sum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (total * w) / sum)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length; k++, left--) parts[order[k]!.i]! += 1
  return parts
}

export interface SummarySale {
  id: string
  discountCents: number
  lines: SaleLine[]
  payments: SalePayment[]
  voidedAt: number | null
}

export interface SummaryExpense {
  amountCents: number
  paidByProfileId: ProfileId
  splitPct: Record<ProfileId, number>
  deletedAt: number | null
}

export interface LineCost {
  knownCostCents: number
  unknownCostQty: number
  oversoldQty: number
}

export interface ProfileShowSummary {
  /** Sale revenue (after any bundle discount) for stock this person owns. */
  revenueCents: number
  /** Revenue from lines whose cost is not fully known; kept out of profit. */
  unknownCostRevenueCents: number
  knownCostCents: number
  /** Revenue minus cost for lines with fully known cost. */
  profitCents: number
  expenseShareCents: number
  expensesPaidCents: number
  /** Profit after this person's share of expenses (known-cost lines only). */
  netProfitCents: number
  /** Money (not trades) this person received from customers. */
  collectedCents: number
  cashCollectedCents: number
  /** Money (not trades) this person is entitled to for their own stock. */
  entitledCents: number
  /** What this person should end up holding after settling (entitled minus expense share). */
  openingFloatCents: number
  expectedCashCents: number
  countedCashCents: number | null
  cashDifferenceCents: number | null
}

export interface ShowSummary {
  salesCount: number
  totalCents: number
  byMethod: Record<PaymentMethod, number>
  expensesTotalCents: number
  perProfile: Record<ProfileId, ProfileShowSummary>
  /** Who pays whom to square up; null when nobody owes anything. */
  settlement: { from: ProfileId; to: ProfileId; amountCents: number } | null
}

const PROFILES: ProfileId[] = ['p1', 'p2']
const blank = (): ProfileShowSummary => ({
  revenueCents: 0, unknownCostRevenueCents: 0, knownCostCents: 0, profitCents: 0, expenseShareCents: 0, expensesPaidCents: 0,
  netProfitCents: 0, collectedCents: 0, cashCollectedCents: 0, entitledCents: 0, openingFloatCents: 0, expectedCashCents: 0,
  countedCashCents: null, cashDifferenceCents: null,
})

export function summarizeShow(input: {
  sales: SummarySale[]
  expenses: SummaryExpense[]
  participants: { profileId: ProfileId; openingFloatCents: number; closingCashCents: number | null }[]
  /** Cost of one sale line (from the FIFO calculation). */
  costOf: (saleId: string, lineIndex: number) => LineCost
}): ShowSummary {
  const per: Record<ProfileId, ProfileShowSummary> = { p1: blank(), p2: blank() }
  const byMethod: Record<PaymentMethod, number> = { cash: 0, card: 0, payid: 0, trade: 0 }
  let totalCents = 0
  let salesCount = 0

  for (const s of input.sales) {
    if (s.voidedAt) continue
    salesCount++
    const lineTotals = s.lines.map((l) => l.qty * l.unitPriceCents)
    const subtotal = lineTotals.reduce((a, b) => a + b, 0)
    const total = subtotal - s.discountCents
    totalCents += total
    for (const p of s.payments) byMethod[p.method] += p.amountCents

    const lineRev = allocate(total, lineTotals)
    const ownerRev: Record<ProfileId, number> = { p1: 0, p2: 0 }
    s.lines.forEach((l, i) => {
      const owner = per[l.ownerProfileId]
      const rev = lineRev[i]!
      const cost = input.costOf(s.id, i)
      owner.revenueCents += rev
      ownerRev[l.ownerProfileId] += rev
      if (cost.unknownCostQty > 0 || cost.oversoldQty > 0) owner.unknownCostRevenueCents += rev
      else {
        owner.knownCostCents += cost.knownCostCents
        owner.profitCents += rev - cost.knownCostCents
      }
    })

    // Real money (not trades) belongs to whoever owns the stock, however it was received.
    const money = s.payments.filter((p) => p.method !== 'trade')
    const moneyTotal = money.reduce((a, p) => a + p.amountCents, 0)
    const entitled = allocate(moneyTotal, PROFILES.map((p) => ownerRev[p]))
    PROFILES.forEach((p, i) => (per[p].entitledCents += entitled[i]!))
    for (const p of money) {
      per[p.receivedByProfileId].collectedCents += p.amountCents
      if (p.method === 'cash') per[p.receivedByProfileId].cashCollectedCents += p.amountCents
    }
  }

  let expensesTotalCents = 0
  for (const e of input.expenses) {
    if (e.deletedAt) continue
    expensesTotalCents += e.amountCents
    per[e.paidByProfileId].expensesPaidCents += e.amountCents
    const shares = allocate(e.amountCents, PROFILES.map((p) => e.splitPct[p] ?? 0))
    PROFILES.forEach((p, i) => (per[p].expenseShareCents += shares[i]!))
  }

  for (const part of input.participants) {
    const p = per[part.profileId]
    p.openingFloatCents = part.openingFloatCents
    p.countedCashCents = part.closingCashCents
  }
  for (const id of PROFILES) {
    const p = per[id]
    p.netProfitCents = p.profitCents - p.expenseShareCents
    p.expectedCashCents = p.openingFloatCents + p.cashCollectedCents
    p.cashDifferenceCents = p.countedCashCents === null ? null : p.countedCashCents - p.expectedCashCents
  }

  // Each person should finish with: entitled - expense share. They actually hold: collected - expenses they paid.
  const owed = (id: ProfileId) => per[id].entitledCents - per[id].expenseShareCents - (per[id].collectedCents - per[id].expensesPaidCents)
  const d1 = owed('p1')
  const settlement = d1 === 0 ? null : d1 > 0 ? { from: 'p2' as const, to: 'p1' as const, amountCents: d1 } : { from: 'p1' as const, to: 'p2' as const, amountCents: -d1 }

  return { salesCount, totalCents, byMethod, expensesTotalCents, perProfile: per, settlement }
}
