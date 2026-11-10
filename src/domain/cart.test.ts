import { describe, expect, it } from 'vitest'
import { addToCart, cartToDraft, cartTotals, oversoldLines, type CartLine } from './cart'
import { validateSale } from './sale'

const base = { itemId: 'A', ownerProfileId: 'p1' as const, name: 'Gengar', stickerPriceCents: 3000, unitPriceCents: 3000, available: 2 }

describe('cart', () => {
  it('adding the same item at the same price increases the quantity', () => {
    let cart: CartLine[] = []
    cart = addToCart(cart, base)
    cart = addToCart(cart, base)
    expect(cart).toHaveLength(1)
    expect(cart[0]!.qty).toBe(2)
  })

  it('a different price makes a separate line', () => {
    const cart = addToCart(addToCart([], base), { ...base, unitPriceCents: 2500 })
    expect(cart).toHaveLength(2)
  })

  it('totals include the discount, and a bundle becomes a valid one-payment sale', () => {
    let cart = addToCart([], base)
    cart = addToCart(cart, { itemId: 'B', ownerProfileId: 'p2', name: 'Mew', stickerPriceCents: 2000, unitPriceCents: 2000, available: 1 })
    expect(cartTotals(cart, 500)).toEqual({ subtotalCents: 5000, totalCents: 4500 })
    const draft = cartToDraft(cart, { soldBy: 'p1', method: 'payid', discountCents: 500 })
    expect(draft.payments).toEqual([{ method: 'payid', amountCents: 4500, receivedByProfileId: 'p1' }])
    expect(validateSale(draft)).toEqual([])
  })

  it('warns about lines that sell more than is in stock', () => {
    let cart = addToCart([], base)
    cart = addToCart(cart, base)
    expect(oversoldLines(cart)).toEqual([])
    cart = addToCart(cart, { ...base, unitPriceCents: 2900 })
    expect(oversoldLines(cart)).toHaveLength(2)
  })

  it('an empty cart is not a valid sale', () => {
    expect(validateSale(cartToDraft([], { soldBy: 'p1', method: 'cash', discountCents: 0 }))).toContain('Add at least one item')
  })
})
