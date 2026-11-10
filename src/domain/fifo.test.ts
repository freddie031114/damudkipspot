import { describe, expect, it } from 'vitest'
import { allocateFifo, type Demand, type Supply } from './fifo'

const sup = (id: string, at: number, qty: number, cost: number | null, itemId = 'A'): Supply => ({
  id, itemId, at, seq: at, qty, unitCostCents: cost,
})
const dem = (id: string, at: number, qty: number, itemId = 'A'): Demand => ({ id, itemId, at, seq: at, qty })

describe('allocateFifo', () => {
  it('consumes the oldest lot first and prices each unit at its own lot cost', () => {
    const r = allocateFifo([sup('L1', 1, 2, 1000), sup('L2', 2, 3, 1500)], [dem('S1', 10, 3)])
    expect(r.allocations).toEqual([
      { demandId: 'S1', supplyId: 'L1', qty: 2, unitCostCents: 1000 },
      { demandId: 'S1', supplyId: 'L2', qty: 1, unitCostCents: 1500 },
    ])
    expect(r.costByDemand.get('S1')).toEqual({ knownCostCents: 3500, unknownCostQty: 0, oversoldQty: 0 })
    expect(r.onHandByItem.get('A')).toBe(2)
    expect(r.remainingKnownCostByItem.get('A')).toBe(3000)
  })

  it('is independent of input order (offline devices syncing late)', () => {
    const s = [sup('L1', 1, 2, 1000), sup('L2', 2, 3, 1500)]
    const d = [dem('S1', 10, 1), dem('S2', 11, 2)]
    const a = allocateFifo(s, d)
    const b = allocateFifo([...s].reverse(), [...d].reverse())
    expect(b.allocations).toEqual(a.allocations)
    expect(b.onHandByItem).toEqual(a.onHandByItem)
  })

  it('records oversold units instead of dropping the sale', () => {
    const r = allocateFifo([sup('L1', 1, 1, 500)], [dem('S1', 5, 1), dem('S2', 6, 2)])
    expect(r.costByDemand.get('S2')).toEqual({ knownCostCents: 0, unknownCostQty: 0, oversoldQty: 2 })
    expect(r.oversoldByItem.get('A')).toBe(2)
    expect(r.onHandByItem.get('A')).toBe(0)
  })

  it('flags unknown-cost units (opening stock) separately from known cost', () => {
    const r = allocateFifo([sup('OPEN', 0, 2, null), sup('L2', 3, 2, 800)], [dem('S1', 9, 3)])
    expect(r.costByDemand.get('S1')).toEqual({ knownCostCents: 800, unknownCostQty: 2, oversoldQty: 0 })
  })

  it('keeps items separate', () => {
    const r = allocateFifo([sup('L1', 1, 1, 100, 'A'), sup('L2', 1, 5, 200, 'B')], [dem('S1', 2, 1, 'B')])
    expect(r.onHandByItem.get('A')).toBe(1)
    expect(r.onHandByItem.get('B')).toBe(4)
  })

  it('a voided sale is simply not passed as demand, restoring stock', () => {
    const s = [sup('L1', 1, 3, 100)]
    expect(allocateFifo(s, [dem('S1', 2, 2)]).onHandByItem.get('A')).toBe(1)
    expect(allocateFifo(s, []).onHandByItem.get('A')).toBe(3)
  })
})
