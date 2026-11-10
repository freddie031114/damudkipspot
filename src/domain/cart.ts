import type { PaymentMethod, ProfileId, SaleDraft } from './sale'

export interface CartLine {
  itemId: string
  ownerProfileId: ProfileId
  name: string
  stickerPriceCents: number
  unitPriceCents: number
  qty: number
  /** Stock on hand when added, used to warn about overselling. */
  available: number
}

/** Adds one of an item; the same item at the same price just increases the quantity. */
export function addToCart(cart: CartLine[], line: Omit<CartLine, 'qty'>): CartLine[] {
  const i = cart.findIndex((l) => l.itemId === line.itemId && l.unitPriceCents === line.unitPriceCents)
  if (i >= 0) return cart.map((l, n) => (n === i ? { ...l, qty: l.qty + 1 } : l))
  return [...cart, { ...line, qty: 1 }]
}

export function cartTotals(cart: CartLine[], discountCents: number) {
  const subtotalCents = cart.reduce((n, l) => n + l.qty * l.unitPriceCents, 0)
  return { subtotalCents, totalCents: subtotalCents - discountCents }
}

/** Lines where the cart sells more than is in stock (still allowed, but worth a warning). */
export function oversoldLines(cart: CartLine[]): CartLine[] {
  const byItem = new Map<string, number>()
  for (const l of cart) byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + l.qty)
  return cart.filter((l) => (byItem.get(l.itemId) ?? 0) > l.available)
}

/** A one-payment sale for the whole cart, taken by the person selling. */
export function cartToDraft(cart: CartLine[], opts: { soldBy: ProfileId; method: PaymentMethod; discountCents: number }): SaleDraft {
  const { totalCents } = cartTotals(cart, opts.discountCents)
  return {
    soldByProfileId: opts.soldBy,
    discountCents: opts.discountCents,
    lines: cart.map((l) => ({ itemId: l.itemId, ownerProfileId: l.ownerProfileId, qty: l.qty, stickerPriceCents: l.stickerPriceCents, unitPriceCents: l.unitPriceCents })),
    payments: [{ method: opts.method, amountCents: totalCents, receivedByProfileId: opts.soldBy }],
  }
}
