import type { PaymentMethod, ProfileId, SaleDraft, SaleLine, SalePayment, SaleTradeIn, TradeInInput } from './sale'
import { allocate, type LineCost } from './show'

/**
 * A deal is how things are logged at the table: the cards that went out, the cards that came in,
 * and the cash that changed hands (either way). No per-card prices are needed. A plain sale is a
 * deal with only cards out and cash in; a buy is only cards in and cash out; a trade is both.
 */
export interface DealOut {
  itemId: string
  ownerProfileId: ProfileId
  qty: number
  /** Current sticker price each. Only used to share the deal's value between the cards. */
  stickerPriceCents: number
}

export interface DealIn {
  /** An item already in stock these cards join, or null for a card not held yet. */
  itemId: string | null
  /** Whose stock the cards go into. */
  ownerProfileId: ProfileId
  name: string
  cardNumber: string
  qty: number
  /** What each card is worth (optional). Sets the market price of a new card and how the cost is shared. */
  worthCents: number | null
}

export interface DealInput {
  by: ProfileId
  out: DealOut[]
  incoming: DealIn[]
  /** Money that changed hands: positive when the customer paid us, negative when we paid them, 0 for an even swap. */
  cashCents: number
  /** How the money moved. */
  method: PaymentMethod
  game?: string
}

export interface DealNumbers {
  /** Sticker value of the cards going out. */
  stickerCents: number
  /** What the cards going out are counted as sold for. */
  revenueCents: number
  /** What the cards coming in cost us (their cost basis when they sell later). */
  tradeValueCents: number
}

/**
 * Works out the money side of a deal from the one number people actually know: the cash.
 * - Only cards out: they sold for the cash received.
 * - Cards both ways: the cards out count at their sticker value, so the cards in cost that value
 *   minus any cash received (or plus any cash paid).
 * - Only cards in: they cost the cash paid.
 * Throws a message fit to show the user when the deal makes no sense.
 */
export function dealNumbers(d: Pick<DealInput, 'out' | 'incoming' | 'cashCents'>): DealNumbers {
  if (!Number.isInteger(d.cashCents)) throw new Error('Enter a valid cash amount')
  if (d.out.length === 0 && d.incoming.length === 0) throw new Error('Add the cards that went out or came in')
  const stickerCents = d.out.reduce((n, o) => n + o.qty * o.stickerPriceCents, 0)
  if (d.incoming.length === 0) {
    if (d.cashCents < 0) throw new Error('You paid cash but got no cards. Add the cards that came in')
    return { stickerCents, revenueCents: d.cashCents, tradeValueCents: 0 }
  }
  if (d.out.length === 0) {
    if (d.cashCents > 0) throw new Error('They paid you but nothing went out. Add the cards you gave, or change the cash to “we paid”')
    return { stickerCents: 0, revenueCents: 0, tradeValueCents: -d.cashCents }
  }
  const revenueCents = Math.max(stickerCents, d.cashCents)
  return { stickerCents, revenueCents, tradeValueCents: revenueCents - d.cashCents }
}

/** Turns a deal into the sale record that is saved (lines, trade-ins and payments that add up exactly). */
export function dealToDraft(d: DealInput): SaleDraft {
  for (const o of d.out) if (!Number.isInteger(o.qty) || o.qty < 1) throw new Error('Quantities must be whole numbers of at least 1')
  for (const i of d.incoming) {
    if (!i.name.trim()) throw new Error('Name each card that came in')
    if (!Number.isInteger(i.qty) || i.qty < 1) throw new Error('Quantities must be whole numbers of at least 1')
    if (i.worthCents !== null && (!Number.isInteger(i.worthCents) || i.worthCents < 0)) throw new Error('A card’s worth must be zero or more')
  }
  const n = dealNumbers(d)

  // Sticker prices are only weights for sharing the deal's value; unpriced stock shares it evenly.
  const weightEach = (o: DealOut) => (n.stickerCents > 0 ? o.stickerPriceCents : 100)
  const lines: SaleLine[] = d.out.map((o) => ({ itemId: o.itemId, ownerProfileId: o.ownerProfileId, qty: o.qty, stickerPriceCents: o.stickerPriceCents, unitPriceCents: weightEach(o) }))
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPriceCents, 0)

  // The cost of the cards coming in is shared by what each is worth, or evenly when that is not known.
  const allWorth = d.incoming.every((i) => (i.worthCents ?? 0) > 0)
  const shares = allocate(n.tradeValueCents, d.incoming.map((i) => (allWorth ? i.worthCents! * i.qty : i.qty)))
  const tradeIns: TradeInInput[] = d.incoming.map((i, k) => ({
    itemId: i.itemId,
    ownerProfileId: i.ownerProfileId,
    qty: i.qty,
    creditCents: Math.floor(shares[k]! / i.qty),
    totalCreditCents: shares[k]!,
    ...(i.itemId === null
      ? { item: { name: i.name.trim(), setName: '', cardNumber: i.cardNumber.trim(), variant: '', condition: '', game: d.game ?? 'Pokémon', marketPriceCents: i.worthCents ?? 0 } }
      : {}),
  }))

  const payments: SalePayment[] = []
  if (n.tradeValueCents > 0) payments.push({ method: 'trade', amountCents: n.tradeValueCents, receivedByProfileId: d.by })
  if (d.cashCents !== 0) {
    // Money handed to a customer is cash or a transfer, never a card payment.
    const method = d.method === 'trade' || (d.cashCents < 0 && d.method === 'card') ? 'cash' : d.method
    payments.push({ method, amountCents: d.cashCents, receivedByProfileId: d.by })
  }

  return {
    soldByProfileId: d.by,
    lines,
    payments,
    discountCents: subtotal - n.revenueCents,
    ...(tradeIns.length ? { tradeIns } : {}),
  }
}

// ---------- reading saved deals back ----------

export interface DealSale {
  id: string
  discountCents: number
  lines: SaleLine[]
  payments: SalePayment[]
  tradeIns?: SaleTradeIn[]
  voidedAt: number | null
}

export interface DealSummary {
  kind: 'sale' | 'trade' | 'buy'
  outUnits: number
  inUnits: number
  /** Money received (positive) or paid out (negative), over every payment that is not trade credit. */
  cashCents: number
  /** What the cards coming in were valued at. */
  tradeValueCents: number
  /** What the cards going out counted as sold for. */
  revenueCents: number
  /** Revenue minus cost of the cards that went out; null when any of them has no recorded cost. */
  profitCents: number | null
}

export function summarizeDeal(s: DealSale, costOf: (saleId: string, lineIndex: number) => LineCost): DealSummary {
  const outUnits = s.lines.reduce((n, l) => n + l.qty, 0)
  const inUnits = (s.tradeIns ?? []).reduce((n, t) => n + t.qty, 0)
  const cashCents = s.payments.filter((p) => p.method !== 'trade').reduce((n, p) => n + p.amountCents, 0)
  const tradeValueCents = s.payments.filter((p) => p.method === 'trade').reduce((n, p) => n + p.amountCents, 0)
  const revenueCents = s.lines.reduce((n, l) => n + l.qty * l.unitPriceCents, 0) - s.discountCents
  let cost = 0
  let known = true
  s.lines.forEach((_, i) => {
    const c = costOf(s.id, i)
    if (c.unknownCostQty > 0 || c.oversoldQty > 0) known = false
    cost += c.knownCostCents
  })
  return {
    kind: outUnits === 0 ? 'buy' : inUnits > 0 || tradeValueCents > 0 ? 'trade' : 'sale',
    outUnits, inUnits, cashCents, tradeValueCents, revenueCents,
    profitCents: outUnits === 0 ? null : known ? revenueCents - cost : null,
  }
}

/** "+$20.00 cash", "−$30.00 cash" or "Even swap", for lists. */
export function cashLabel(cashCents: number, fmt: (c: number) => string): string {
  return cashCents === 0 ? 'No cash' : cashCents > 0 ? `+${fmt(cashCents)}` : `−${fmt(-cashCents)}`
}
