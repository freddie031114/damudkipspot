import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTable } from '../import/csv'
import { parseSheetGrid } from '../import/sheet'
import { createItem, importItems, markStickered, updateItem } from './changes'
import { buildInventory } from './derive'
import { memorySource } from './memorySource'

let n = 0
const ctx = (now = 1000) => ({ actor: 'p1' as const, now, newId: () => `id${++n}` })

describe('needs re-sticker', () => {
  it('flags an item once its price moves more than the threshold from the sticker on the card', async () => {
    const src = memorySource()
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 10000, stickeredPriceCents: 11000 }, { qty: 1, unitCostCents: null }).ops)
    expect(buildInventory(src.data)[0]!.needsSticker).toBe(false)
    // 10% rule: market $105 -> sticker $116 is +5.5%, fine. Market $120 -> sticker $132 is +20%, flagged.
    await src.commit(updateItem(ctx(), src.data.items[0]!, { marketPriceCents: 10500 })!.ops)
    expect(buildInventory(src.data)[0]!.needsSticker).toBe(false)
    await src.commit(updateItem(ctx(), src.data.items[0]!, { marketPriceCents: 12000 })!.ops)
    expect(buildInventory(src.data)[0]!.needsSticker).toBe(true)
  })

  it('does not flag items that were never stickered or are bulk', async () => {
    const src = memorySource()
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'New', marketPriceCents: 5000 }, { qty: 1, unitCostCents: null }).ops)
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'Bulk', kind: 'bulk', marketPriceCents: 5000, stickeredPriceCents: 100 }, { qty: 1, unitCostCents: null }).ops)
    expect(buildInventory(src.data).some((r) => r.needsSticker)).toBe(false)
  })

  it('"mark stickered" clears the flag in one undoable step', async () => {
    const src = memorySource()
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'A', marketPriceCents: 10000, stickeredPriceCents: 5000 }, { qty: 1, unitCostCents: null }).ops)
    await src.commit(createItem(ctx(), { profileId: 'p1', name: 'B', marketPriceCents: 10000, stickeredPriceCents: 5000 }, { qty: 1, unitCostCents: null }).ops)
    const flagged = buildInventory(src.data)
    expect(flagged.every((r) => r.needsSticker)).toBe(true)
    const change = markStickered(ctx(), flagged)!
    await src.commit(change.ops)
    expect(buildInventory(src.data).some((r) => r.needsSticker)).toBe(false)
    expect(src.data.items.every((i) => i.stickeredPriceCents === 11000)).toBe(true)
    await src.commit(change.inverse!(ctx(5000)))
    expect(buildInventory(src.data).every((r) => r.needsSticker)).toBe(true)
  })

  it('markStickered with nothing to change returns null', () => {
    expect(markStickered(ctx(), [])).toBeNull()
  })

  it('imported sheet stock records the sticker already on each card, so nothing starts flagged', async () => {
    const rows = parseSheetGrid(parseTable(readFileSync(new URL('../import/sheet.fixture.csv', import.meta.url), 'utf8'))).rows
    const src = memorySource()
    await src.commit(importItems(ctx(), rows, 'sheet.csv').ops)
    const inv = buildInventory(src.data)
    expect(inv.filter((r) => r.needsSticker)).toEqual([])
    const arbok = inv.find((r) => r.item.name === 'Arbok')!
    expect(arbok.item.stickeredPriceCents).toBe(4000)
    expect(arbok.sticker).toBe(4000)
    const serperior = inv.find((r) => r.item.name === 'Serperior')!
    expect(serperior.item.stickeredPriceCents).toBe(4510)
    // Slabs and bulk have no sticker column.
    expect(inv.find((r) => r.item.name === 'Bulk cards')!.item.stickeredPriceCents).toBeNull()
    expect(inv.find((r) => r.item.name.startsWith('Charizard 20th'))!.item.stickeredPriceCents).toBeNull()
  })
})
