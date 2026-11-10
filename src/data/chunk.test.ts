import { describe, expect, it } from 'vitest'
import { chunkOps } from './chunk'
import type { WriteOp } from './types'

const op = (id: string, atom?: string): WriteOp => ({ collection: 'items', id, data: {}, merge: false, atom })

describe('chunkOps', () => {
  it('keeps everything in one batch when it fits', () => {
    expect(chunkOps([op('a'), op('b'), op('c')], 10)).toHaveLength(1)
  })
  it('never splits an atom across batches', () => {
    const ops: WriteOp[] = []
    for (let i = 0; i < 10; i++) ops.push(op(`i${i}`, `a${i}`), op(`l${i}`, `a${i}`), op(`p${i}`, `a${i}`))
    const batches = chunkOps(ops, 7)
    expect(batches.every((b) => b.length <= 7)).toBe(true)
    for (const b of batches) {
      const atoms = new Set(b.map((o) => o.atom))
      for (const a of atoms) expect(b.filter((o) => o.atom === a)).toHaveLength(3)
    }
    expect(batches.flat()).toHaveLength(30)
  })
  it('keeps order', () => {
    const ops = [op('1'), op('2'), op('3'), op('4'), op('5')]
    expect(chunkOps(ops, 2).flat().map((o) => o.id)).toEqual(['1', '2', '3', '4', '5'])
  })
  it('rejects an atom that is larger than a batch', () => {
    expect(() => chunkOps([op('1', 'x'), op('2', 'x'), op('3', 'x')], 2)).toThrow()
  })
})
