import { parseMoney } from './money'
import type { ProfileId, TradeInInput } from './sale'

/** A card received in trade, as it sits in the sale screen before the sale is saved. */
export interface TradeInDraft {
  key: string
  /** An item already in stock that these cards join, or null for a card not in stock yet. */
  itemId: string | null
  ownerProfileId: ProfileId
  name: string
  cardNumber: string
  condition: string
  qty: number
  /** Credit given per card. */
  creditCents: number
  /** Market price each for a new card; 0 means "use the credit". */
  marketCents: number
}

export interface TradeEntryForm {
  name: string
  cardNumber: string
  condition: string
  qty: string
  credit: string
  market: string
}

/** Turns what was typed into a trade-in, or throws a message fit to show the user. */
export function parseTradeEntry(f: TradeEntryForm, owner: ProfileId, key: string, existing?: { itemId: string }): TradeInDraft {
  const name = f.name.trim()
  if (!name) throw new Error('Name the card you are taking')
  const qty = Number(f.qty)
  if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of at least 1')
  const credit = parseMoney(f.credit)
  if (credit === null || credit < 0) throw new Error('Enter the credit you are giving for each card')
  const market = f.market.trim() === '' ? 0 : parseMoney(f.market)
  if (market === null || market < 0) throw new Error('Market price is not a valid amount')
  return {
    key, itemId: existing?.itemId ?? null, ownerProfileId: owner, name, cardNumber: f.cardNumber.trim(),
    condition: f.condition.trim(), qty, creditCents: credit, marketCents: market,
  }
}

export function toTradeInInputs(drafts: TradeInDraft[], game = 'Pokémon'): TradeInInput[] {
  return drafts.map((d) => ({
    itemId: d.itemId,
    ownerProfileId: d.ownerProfileId,
    qty: d.qty,
    creditCents: d.creditCents,
    ...(d.itemId === null
      ? { item: { name: d.name, setName: '', cardNumber: d.cardNumber, variant: '', condition: d.condition, game, marketPriceCents: d.marketCents } }
      : {}),
  }))
}

/** What the customer still owes after the trade (negative: we hand cash back). */
export function tradeBalanceCents(saleTotalCents: number, drafts: Pick<TradeInDraft, 'qty' | 'creditCents'>[]): number {
  return saleTotalCents - drafts.reduce((n, d) => n + d.qty * d.creditCents, 0)
}
