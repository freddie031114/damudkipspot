/**
 * FIFO stock and cost of goods, derived from append-only records.
 *
 * Supply = lots (and positive adjustments as cost-unknown lots).
 * Demand = non-voided sale lines and negative adjustments.
 * Demand consumes the oldest supply first. Whether a lot was entered before or after a
 * sale is ignored on purpose, so the result is identical on every device regardless of
 * the order in which offline writes arrive.
 */

export interface Supply {
  id: string
  itemId: string
  /** Acquisition time (ms). Oldest is consumed first. */
  at: number
  /** Tie-breaker when `at` is equal (e.g. creation time). */
  seq: number
  qty: number
  /** null = cost not recorded (opening stock). */
  unitCostCents: number | null
}

export interface Demand {
  id: string
  itemId: string
  at: number
  seq: number
  qty: number
}

export interface Allocation {
  demandId: string
  supplyId: string
  qty: number
  unitCostCents: number | null
}

export interface DemandCost {
  /** Total cost of the allocated units whose cost is known. */
  knownCostCents: number
  /** Allocated units whose supply has no recorded cost. */
  unknownCostQty: number
  /** Units with no supply at all (oversold). */
  oversoldQty: number
}

export interface FifoResult {
  allocations: Allocation[]
  costByDemand: Map<string, DemandCost>
  /** Supply left after all demand, per supply id. */
  remainingBySupply: Map<string, number>
  onHandByItem: Map<string, number>
  /** Cost of remaining stock with a known cost, per item. */
  remainingKnownCostByItem: Map<string, number>
  /** Total units sold beyond available supply, per item. */
  oversoldByItem: Map<string, number>
}

const byTime = <T extends { at: number; seq: number; id: string }>(a: T, b: T) =>
  a.at - b.at || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function allocateFifo(supplies: Supply[], demands: Demand[]): FifoResult {
  const supplyByItem = new Map<string, Supply[]>()
  for (const s of [...supplies].sort(byTime)) {
    if (s.qty <= 0) continue
    const list = supplyByItem.get(s.itemId) ?? []
    list.push(s)
    supplyByItem.set(s.itemId, list)
  }

  const remaining = new Map<string, number>()
  for (const list of supplyByItem.values()) for (const s of list) remaining.set(s.id, s.qty)

  const allocations: Allocation[] = []
  const costByDemand = new Map<string, DemandCost>()
  const oversoldByItem = new Map<string, number>()

  for (const d of [...demands].sort(byTime)) {
    const cost: DemandCost = { knownCostCents: 0, unknownCostQty: 0, oversoldQty: 0 }
    let need = d.qty
    for (const s of supplyByItem.get(d.itemId) ?? []) {
      if (need <= 0) break
      const left = remaining.get(s.id) ?? 0
      if (left <= 0) continue
      const take = Math.min(left, need)
      remaining.set(s.id, left - take)
      need -= take
      allocations.push({ demandId: d.id, supplyId: s.id, qty: take, unitCostCents: s.unitCostCents })
      if (s.unitCostCents === null) cost.unknownCostQty += take
      else cost.knownCostCents += take * s.unitCostCents
    }
    if (need > 0) {
      cost.oversoldQty = need
      oversoldByItem.set(d.itemId, (oversoldByItem.get(d.itemId) ?? 0) + need)
    }
    costByDemand.set(d.id, cost)
  }

  const onHandByItem = new Map<string, number>()
  const remainingKnownCostByItem = new Map<string, number>()
  for (const [itemId, list] of supplyByItem) {
    let qty = 0
    let cost = 0
    for (const s of list) {
      const left = remaining.get(s.id) ?? 0
      qty += left
      if (s.unitCostCents !== null) cost += left * s.unitCostCents
    }
    onHandByItem.set(itemId, qty)
    remainingKnownCostByItem.set(itemId, cost)
  }

  return { allocations, costByDemand, remainingBySupply: remaining, onHandByItem, remainingKnownCostByItem, oversoldByItem }
}
