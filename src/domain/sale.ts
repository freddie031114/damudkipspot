export type PaymentMethod = 'cash' | 'card' | 'payid' | 'trade'

export interface SaleLine {
  itemId: string
  ownerProfileId: string
  qty: number
  stickerPriceCents: number
  unitPriceCents: number
}

export interface SalePayment {
  method: PaymentMethod
  amountCents: number
  receivedByProfileId: string
}

export interface SaleDraft {
  soldByProfileId: string
  lines: SaleLine[]
  payments: SalePayment[]
  discountCents: number
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
export function validateSale(sale: SaleDraft, validProfileIds: readonly string[] = ['p1', 'p2']): string[] {
  const errors: string[] = []
  if (!validProfileIds.includes(sale.soldByProfileId)) errors.push('Unknown seller')
  if (sale.lines.length === 0) errors.push('Add at least one item')
  sale.lines.forEach((l, i) => {
    const n = i + 1
    if (!isInt(l.qty) || l.qty < 1) errors.push(`Line ${n}: quantity must be a whole number of at least 1`)
    if (!isInt(l.unitPriceCents) || l.unitPriceCents < 0) errors.push(`Line ${n}: price must be zero or more`)
    if (!validProfileIds.includes(l.ownerProfileId)) errors.push(`Line ${n}: unknown owner`)
  })
  if (!isInt(sale.discountCents) || sale.discountCents < 0) errors.push('Discount must be zero or more')
  sale.payments.forEach((p, i) => {
    if (!isInt(p.amountCents) || p.amountCents < 0) errors.push(`Payment ${i + 1}: amount must be zero or more`)
  })
  const t = saleTotals(sale)
  if (t.totalCents < 0) errors.push('Discount is larger than the sale')
  if (sale.lines.length > 0 && t.paidCents !== t.totalCents) {
    errors.push('Payments must add up to the sale total')
  }
  return errors
}

/** A single-payment sale from one line, using the sticker price unless overridden. */
export function quickSale(args: {
  soldByProfileId: string
  itemId: string
  ownerProfileId: string
  stickerPriceCents: number
  priceCents?: number
  qty?: number
  method: PaymentMethod
}): SaleDraft {
  const qty = args.qty ?? 1
  const unitPriceCents = args.priceCents ?? args.stickerPriceCents
  return {
    soldByProfileId: args.soldByProfileId,
    discountCents: 0,
    lines: [
      {
        itemId: args.itemId,
        ownerProfileId: args.ownerProfileId,
        qty,
        stickerPriceCents: args.stickerPriceCents,
        unitPriceCents,
      },
    ],
    payments: [{ method: args.method, amountCents: qty * unitPriceCents, receivedByProfileId: args.soldByProfileId }],
  }
}
