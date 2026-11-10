import { createItem, type Ctx } from './changes'
import { memorySource } from './memorySource'

/** Sample stock for the dev-only demo mode (?demo). Never used in production builds. */
export function demoSource(empty = false) {
  const src = memorySource()
  if (empty) return src
  let n = 0
  const ctx: Ctx = { actor: 'p1', now: Date.now() - 3_600_000, newId: () => `demo${++n}` }
  const add = (profileId: 'p1' | 'p2', name: string, number: string, market: number, qty: number, location: string, cost: number | null = null) =>
    void src.commit(createItem(ctx, { profileId, name, cardNumber: number, marketPriceCents: market * 100, location, setName: 'Demo set' }, { qty, unitCostCents: cost === null ? null : cost * 100, source: cost === null ? 'opening' : 'purchase' }).ops)
  add('p1', 'Charizard', '183/165', 70, 2, 'Binder 1', 30)
  add('p1', 'Pikachu', 'XY95', 250, 1, 'Slab box')
  add('p1', 'Gengar', '284/217', 1240, 1, 'Binder 2')
  add('p2', 'Mew', '327/190', 30, 3, 'Binder 3', 12)
  add('p2', 'Umbreon', '085/089', 360, 1, 'Binder 3')
  for (let i = 1; i <= 400; i++) add(i % 2 ? 'p1' : 'p2', `Demo card ${i}`, `${i}/400`, 5 + (i % 40), 1 + (i % 4), `Box ${1 + (i % 6)}`)
  return src
}
