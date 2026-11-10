import { describe, expect, it } from 'vitest'
import { parseTradeEntry, toTradeInInputs, tradeBalanceCents } from './trade'

const form = { name: ' Pikachu ', cardNumber: ' 25 ', condition: 'NM', qty: '2', credit: '$15', market: '' }

describe('parseTradeEntry', () => {
  it('reads a new card from what was typed', () => {
    expect(parseTradeEntry(form, 'p1', 'k1')).toEqual({
      key: 'k1', itemId: null, ownerProfileId: 'p1', name: 'Pikachu', cardNumber: '25', condition: 'NM', qty: 2, creditCents: 1500, marketCents: 0,
    })
  })
  it('keeps the item when the card is already in stock', () => {
    expect(parseTradeEntry(form, 'p2', 'k', { itemId: 'abc' })).toMatchObject({ itemId: 'abc', ownerProfileId: 'p2' })
  })
  it('explains what is wrong', () => {
    expect(() => parseTradeEntry({ ...form, name: ' ' }, 'p1', 'k')).toThrow('Name the card')
    expect(() => parseTradeEntry({ ...form, qty: '0' }, 'p1', 'k')).toThrow('Quantity')
    expect(() => parseTradeEntry({ ...form, credit: '' }, 'p1', 'k')).toThrow('credit')
    expect(() => parseTradeEntry({ ...form, market: 'abc' }, 'p1', 'k')).toThrow('Market price')
  })
  it('allows a card taken for no credit', () => {
    expect(parseTradeEntry({ ...form, credit: '0' }, 'p1', 'k').creditCents).toBe(0)
  })
})

describe('toTradeInInputs', () => {
  it('sends new-card details only for cards not in stock', () => {
    const a = parseTradeEntry(form, 'p1', 'a')
    const b = parseTradeEntry(form, 'p1', 'b', { itemId: 'x' })
    const [na, nb] = toTradeInInputs([a, b])
    expect(na!.item).toMatchObject({ name: 'Pikachu', cardNumber: '25', game: 'Pokémon' })
    expect(nb!.item).toBeUndefined()
    expect(nb!.itemId).toBe('x')
  })
})

describe('tradeBalanceCents', () => {
  it('is what the customer still pays, or minus the cash we hand back', () => {
    expect(tradeBalanceCents(5000, [{ qty: 2, creditCents: 1500 }])).toBe(2000)
    expect(tradeBalanceCents(5000, [{ qty: 1, creditCents: 6000 }])).toBe(-1000)
  })
})
