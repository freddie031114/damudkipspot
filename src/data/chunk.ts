import type { WriteOp } from './types'

/**
 * Splits ops into batches of at most `limit`, never separating ops that share an `atom`
 * (so an imported item and its stock lot always land in the same atomic batch).
 */
export function chunkOps(ops: WriteOp[], limit: number): WriteOp[][] {
  const atoms: WriteOp[][] = []
  for (const op of ops) {
    const last = atoms[atoms.length - 1]
    if (op.atom !== undefined && last && last[0]!.atom === op.atom) last.push(op)
    else atoms.push([op])
  }
  const out: WriteOp[][] = []
  let cur: WriteOp[] = []
  for (const a of atoms) {
    if (a.length > limit) throw new Error(`A single change has ${a.length} operations; the limit is ${limit}`)
    if (cur.length + a.length > limit) { out.push(cur); cur = [] }
    cur.push(...a)
  }
  if (cur.length) out.push(cur)
  return out
}
