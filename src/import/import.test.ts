import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importItems } from '../data/changes'
import { buildInventory } from '../data/derive'
import { memorySource } from '../data/memorySource'
import { parseTable } from './csv'
import { parseSheetGrid } from './sheet'

const rows = parseSheetGrid(parseTable(readFileSync(new URL('./sheet.fixture.csv', import.meta.url), 'utf8'))).rows
let n = 0
const ctx = (now = 1000) => ({ actor: 'p1' as const, now, newId: () => `id${++n}` })

describe('importing the real sheet', () => {
  it('creates every item with an opening lot of unknown cost, and market totals match', async () => {
    const src = memorySource()
    const change = importItems(ctx(), rows, 'sheet.csv')
    await src.commit(change.ops)
    const inv = buildInventory(src.data, undefined, 2000)
    expect(inv).toHaveLength(change.count)
    expect(change.count).toBe(47 + 52 + 15 + 2)
    const value = (p: string) => inv.filter((r) => r.item.profileId === p).reduce((s, r) => s + r.marketValueCents, 0)
    expect(value('p2')).toBe(696100 + 175000 + 1571000) // Ferrell
    expect(value('p1')).toBe(357000 + 125400) // Freddie
    expect(inv.every((r) => r.costUnknown)).toBe(true)
    expect(src.data.lots.every((l) => l.unitCostCents === null && l.source === 'opening')).toBe(true)
    expect(inv.find((r) => r.item.name === 'Lucario')!.qty).toBe(8)
  })

  it('skips rows the user unticked or that have blocking problems', () => {
    const edited = rows.map((r, i) => (i === 0 ? { ...r, include: false } : i === 1 ? { ...r, blocking: ['bad'] } : r))
    expect(importItems(ctx(), edited, 'x.csv').count).toBe(rows.length - 2)
  })

  it('refuses an empty import', () => {
    expect(() => importItems(ctx(), rows.map((r) => ({ ...r, include: false })), 'x.csv')).toThrow('Nothing to import')
  })

  it('undo removes the whole import, and the batch is marked undone', async () => {
    const src = memorySource()
    const change = importItems(ctx(), rows, 'sheet.csv')
    await src.commit(change.ops)
    await src.commit(change.inverse!(ctx(5000)))
    expect(buildInventory(src.data, undefined, 6000)).toHaveLength(0)
  })

  it('keeps every item with its lot in the same atom (never split across batches)', () => {
    const change = importItems(ctx(), rows, 'sheet.csv')
    const byAtom = new Map<string, string[]>()
    for (const o of change.ops) if (o.atom) byAtom.set(o.atom, [...(byAtom.get(o.atom) ?? []), o.collection])
    for (const cols of byAtom.values()) expect(cols).toEqual(expect.arrayContaining(['items', 'lots']))
  })
})
