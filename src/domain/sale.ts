export type ProfileId = 'p1' | 'p2'
export const PROFILE_IDS: readonly ProfileId[] = ['p1', 'p2']

export type PaymentMethod = 'cash' | 'card' | 'payid' | 'trade'

export interface SaleLine {
  itemId: string
  ownerProfileId: ProfileId
  qty: number
  stickerPriceCents: number
  unitPriceCents: number
}

export interface SalePayment {
  method: PaymentMethod
  amountCents: number
  receivedByProfileId: ProfileId
}

/** Details for a card that is not in stock yet; a trade-in creates it. */
export interface NewTradeItem {
  name: string
  setName: string
  cardNumber: string
  variant: string
  condition: string
  game: string
  /** Market price each; defaults to the credit given when left at zero. */
  marketPriceCents: number
}

/** A card received from the customer as part of a trade (before it is saved). */
export interface TradeInInput {
  /** An item already in stock that the cards join, or null to create one from `item`. */
  itemId: string | null
  /** Whose stock the cards go into. */
  ownerProfileId: ProfileId
  qty: number
  /** Credit given per card. It becomes the unit cost of the new stock lot. */
  creditCents: number
  /**
   * Credit for the whole entry, when it does not divide evenly by `qty` (a deal splits one lump
   * value across the cards). Overrides `creditCents`; the stock is split into lots so the cents add up exactly.
   */
  totalCreditCents?: number
  item?: NewTradeItem
}

/** Credit given for one trade-in entry (all of its cards). */
export function tradeInputCreditCents(t: Pick<TradeInInput, 'qty' | 'creditCents' | 'totalCreditCents'>): number {
  return t.totalCreditCents ?? t.qty * t.creditCents
}

/** The saved record of a trade-in, kept on the sale so it can be shown and undone. */
export interface SaleTradeIn {
  itemId: string
  ownerProfileId: ProfileId
  qty: number
  creditCents: number
  /** The stock lot this trade-in created. */
  lotId: string
  /** True when the trade-in also created the item (so voiding the sale removes it again). */
  createdItem: boolean
}

/**
 * Cards that went out without being matched to specific stock: just a value, taken from that
 * person's bulk cards. Used when a deal is logged quickly with totals instead of individual cards.
 */
export interface LooseOut {
  ownerProfileId: ProfileId
  valueCents: number
}

export interface SaleDraft {
  soldByProfileId: ProfileId
  lines: SaleLine[]
  payments: SalePayment[]
  discountCents: number
  tradeIns?: TradeInInput[]
  looseOut?: LooseOut
}

/** Total credit given for the cards received. */
export function tradeCreditCents(tradeIns: { qty: number; creditCents: number }[] | undefined): number {
  return (tradeIns ?? []).reduce((n, t) => n + t.qty * t.creditCents, 0)
}

/**
 * Payments for a sale: the trade credit, then the balance by `method`. If the cards received are
 * worth more than the sale, the difference goes back to the customer as cash (a negative payment).
 */
export function settlePayments(args: { totalCents: number; creditCents: number; method: PaymentMethod; receivedBy: ProfileId }): SalePayment[] {
  const { totalCents, creditCents, receivedBy } = args
  const out: SalePayment[] = []
  if (creditCents > 0) out.push({ method: 'trade', amountCents: creditCents, receivedByProfileId: receivedBy })
  const balance = totalCents - creditCents
  if (balance > 0) out.push({ method: creditCents > 0 && args.method === 'trade' ? 'cash' : args.method, amountCents: balance, receivedByProfileId: receivedBy })
  else if (balance < 0) out.push({ method: 'cash', amountCents: balance, receivedByProfileId: receivedBy })
  return out
}

export interface SaleTotals {
  subtotalCents: number
  discountCents: number
  totalCents: number
  paidCents: number
}

export function saleTotals(sale: Pick<SaleDraft, 'lines' | 'payments' | 'discountCents'>): SaleTotals {
  const subtotalCents = sale.lines.reduce((n, l) => n + l.qty * l.unitPriceCents, 0)
  const totalCents = subtotalCents - sale.discountCents
  const paidCents = sale.payments.reduce((n, p) => n + p.amountCents, 0)
  return { subtotalCents, discountCents: sale.discountCents, totalCents, paidCents }
}

const isInt = (n: number) => Number.isInteger(n)

/** Returns a list of problems; an empty list means the sale can be saved. */
export function validateSale(sale: SaleDraft, validProfileIds: readonly string[] = PROFILE_IDS): string[] {
  const errors: string[] = []
  if (!validProfileIds.includes(sale.soldByProfileId)) errors.push('Unknown seller')
  // A deal can be a straight buy: cards in, nothing out.
  if (sale.lines.length === 0 && (sale.tradeIns ?? []).length === 0 && !sale.looseOut) errors.push('Add at least one item')
  if (sale.looseOut) {
    if (!isInt(sale.looseOut.valueCents) || sale.looseOut.valueCents <= 0) errors.push('The value of the cards going out must be more than zero')
    if (!validProfileIds.includes(sale.looseOut.ownerProfileId)) errors.push('Unknown owner for the cards going out')
  }
  sale.lines.forEach((l, i) => {
    const n = i + 1
    if (!isInt(l.qty) || l.qty < 1) errors.push(`Line ${n}: quantity must be a whole number of at least 1`)
    if (!isInt(l.unitPriceCents) || l.unitPriceCents < 0) errors.push(`Line ${n}: price must be zero or more`)
    if (!validProfileIds.includes(l.ownerProfileId)) errors.push(`Line ${n}: unknown owner`)
  })
  // The discount is the gap between the sticker prices and what the deal was really worth, so it
  // can be negative (the cards went for more than sticker).
  if (!isInt(sale.discountCents)) errors.push('Discount must be a whole number of cents')
  const trades = sale.tradeIns ?? []
  trades.forEach((t, i) => {
    const n = i + 1
    if (!isInt(t.qty) || t.qty < 1) errors.push(`Trade-in ${n}: quantity must be a whole number of at least 1`)
    if (!isInt(t.creditCents) || t.creditCents < 0) errors.push(`Trade-in ${n}: credit must be zero or more`)
    if (t.totalCreditCents !== undefined && (!isInt(t.totalCreditCents) || t.totalCreditCents < 0)) errors.push(`Trade-in ${n}: credit must be zero or more`)
    if (!validProfileIds.includes(t.ownerProfileId)) errors.push(`Trade-in ${n}: unknown owner`)
    if (t.itemId === null && !t.item?.name.trim()) errors.push(`Trade-in ${n}: name the card`)
    if (t.itemId === null && t.item && (!isInt(t.item.marketPriceCents) || t.item.marketPriceCents < 0)) errors.push(`Trade-in ${n}: market price must be zero or more`)
  })
  sale.payments.forEach((p, i) => {
    // Cash back to the customer is a negative payment, only possible when cards were traded in.
    const refund = trades.length > 0 && p.method !== 'trade' && p.amountCents < 0
    if (!isInt(p.amountCents) || (p.amountCents < 0 && !refund)) errors.push(`Payment ${i + 1}: amount must be zero or more`)
  })
  if (trades.length > 0) {
    const credited = sale.payments.filter((p) => p.method === 'trade').reduce((n, p) => n + p.amountCents, 0)
    if (credited !== trades.reduce((n, x) => n + tradeInputCreditCents(x), 0)) errors.push('Trade credit must equal the value of the cards received')
  }
  const t = saleTotals(sale)
  if (t.totalCents < 0) errors.push('Discount is larger than the sale')
  if ((sale.lines.length > 0 || trades.length > 0 || sale.looseOut) && t.paidCents !== t.totalCents) {
    errors.push('Payments must add up to the sale total')
  }
  return errors
}

/** A single-payment sale from one line, using the sticker price unless overridden. */
export function quickSale(args: {
  soldByProfileId: ProfileId
  itemId: string
  ownerProfileId: ProfileId
  stickerPriceCents: number
  priceCents?: number
  qty?: number
  method: PaymentMethod
  tradeIns?: TradeInInput[]
}): SaleDraft {
  const qty = args.qty ?? 1
  const unitPriceCents = args.priceCents ?? args.stickerPriceCents
  const creditCents = tradeCreditCents(args.tradeIns)
  return {
    soldByProfileId: args.soldByProfileId,
    discountCents: 0,
    ...(args.tradeIns?.length ? { tradeIns: args.tradeIns } : {}),
    lines: [
      {
        itemId: args.itemId,
        ownerProfileId: args.ownerProfileId,
        qty,
        stickerPriceCents: args.stickerPriceCents,
        unitPriceCents,
      },
    ],
    payments: settlePayments({ totalCents: qty * unitPriceCents, creditCents, method: args.method, receivedBy: args.soldByProfileId }),
  }
}
