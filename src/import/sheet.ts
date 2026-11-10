import { parseMoney } from '../domain/money'
import { stickerFromMarket } from '../domain/sticker'
import type { ProfileId } from '../data/types'
import { parseCardName } from './parseName'
import type { BlockCheck, ImportRow, SheetResult } from './types'

const eq = (a: string | undefined, b: string) => (a ?? '').trim().toLowerCase() === b

function baseRow(key: string, profileId: ProfileId, source: string): ImportRow {
  return {
    key, profileId, include: true, kind: 'single', game: 'Pokémon', name: '', setName: '', cardNumber: '', language: 'EN',
    variant: '', condition: '', gradingCompany: '', grade: '', qty: 1, marketCents: null, stickerOverrideCents: null, stickeredCents: null,
    costCents: null, notes: [], source, blocking: [],
  }
}

/**
 * Reads the "two blocks side by side" layout used in the owners' Google Sheet:
 *   Cards | Market | Sticker | (Total/Bulk/Slab side panel) ... repeated for each person.
 * `owners` maps blocks left to right to profiles.
 */
export function parseSheetGrid(grid: string[][], owners: ProfileId[] = ['p2', 'p1']): SheetResult {
  const rows: ImportRow[] = []
  const checks: BlockCheck[] = []
  const errors: string[] = []

  // Find each "Cards | Market | Sticker" header.
  const starts: { r: number; c: number }[] = []
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (eq(grid[r]![c], 'cards') && eq(grid[r]![c + 1], 'market') && eq(grid[r]![c + 2], 'sticker')) starts.push({ r, c })
    }
  }
  if (starts.length === 0) {
    errors.push('Could not find a "Cards | Market | Sticker" header. Is this the right file?')
    return { rows, checks, errors }
  }
  starts.sort((a, b) => a.c - b.c)

  starts.forEach(({ r: h, c }, blockIdx) => {
    const owner = owners[blockIdx] ?? owners[owners.length - 1]!
    const label = blockIdx === 0 ? 'Left block' : blockIdx === 1 ? 'Right block' : `Block ${blockIdx + 1}`
    const cell = (r: number, col: number) => grid[r]?.[col] ?? ''
    let stickerSum = 0
    let count = 0

    for (let r = h + 1; r < grid.length; r++) {
      const raw = cell(r, c).trim()
      if (!raw) continue
      const p = parseCardName(raw)
      const row = baseRow(`${blockIdx}-${r}`, owner, `${label}, row ${r + 1}`)
      const marketTotal = parseMoney(cell(r, c + 1))
      const stickerTotal = parseMoney(cell(r, c + 2))
      if (stickerTotal !== null) stickerSum += stickerTotal
      Object.assign(row, {
        name: p.name, cardNumber: p.cardNumber, qty: p.qty, variant: p.variant, condition: p.condition, language: p.language,
        gradingCompany: p.gradingCompany, grade: p.grade, game: p.game, notes: [...p.notes],
      })
      if (marketTotal === null) {
        row.blocking.push('No usable market price')
        row.include = false
      } else {
        // When a quantity is in the name, the sheet's prices are totals for all copies.
        row.marketCents = p.qty > 1 ? Math.round(marketTotal / p.qty) : marketTotal
        if (stickerTotal !== null) row.stickeredCents = p.qty > 1 ? stickerFromMarket(row.marketCents) : stickerTotal
        if (p.qty > 1) row.notes.push(`Price per card worked out from the total (${p.qty} cards)`)
        if (p.qty === 1 && stickerTotal !== null) {
          const computed = stickerFromMarket(marketTotal)
          const exact = Math.round((marketTotal * 1100) / 1000)
          if (stickerTotal !== computed && stickerTotal !== exact) {
            row.stickerOverrideCents = stickerTotal
            row.notes.push('Sticker differs from market × 1.1: kept as a manual sticker')
          }
        }
      }
      if (p.gradingCompany) row.kind = 'graded'
      if (!p.name) { row.blocking.push('No name'); row.include = false }
      rows.push(row)
      count++
    }

    // Side panel: Total / Bulk / Slab list.
    const pc = c + 3
    const vc = c + 4
    let reportedCardsTotal: number | null = null
    let reportedGrandTotal: number | null = null
    let bulk: number | null = null
    let reportedSlabsTotal: number | null = null
    let slabsSum = 0
    let slabRows = 0

    for (let r = h; r < grid.length; r++) {
      if (eq(cell(r, pc), 'total') && eq(cell(r, vc), 'bulk') && reportedCardsTotal === null) {
        reportedCardsTotal = parseMoney(cell(r + 1, pc))
        bulk = parseMoney(cell(r + 1, vc))
      } else if (eq(cell(r, pc), 'total') && eq(cell(r, vc), 'slabs')) {
        reportedGrandTotal = parseMoney(cell(r + 1, pc))
      }
    }
    if (bulk !== null && bulk > 0) {
      const b = baseRow(`${blockIdx}-bulk`, owner, `${label}, bulk figure`)
      Object.assign(b, { kind: 'bulk', name: 'Bulk cards', game: 'Pokémon', marketCents: bulk, notes: ['Lump-sum value of bulk cards from the sheet'] })
      rows.push(b)
    }
    const slabHead = grid.findIndex((_, r) => r > h && eq(cell(r, pc), 'slab'))
    if (slabHead >= 0) {
      for (let r = slabHead + 1; r < grid.length; r++) {
        const name = cell(r, pc).trim()
        if (!name) continue
        if (eq(name, 'total')) { reportedSlabsTotal = parseMoney(cell(r, vc)); break }
        const p = parseCardName(name)
        const price = parseMoney(cell(r, vc))
        const row = baseRow(`${blockIdx}-slab-${r}`, owner, `${label}, slab row ${r + 1}`)
        Object.assign(row, {
          kind: 'graded', name: p.name, cardNumber: p.cardNumber, variant: p.variant, language: p.language, game: p.game,
          gradingCompany: p.gradingCompany, grade: p.grade, marketCents: price, notes: [...p.notes],
        })
        if (price === null) { row.blocking.push('No usable market price'); row.include = false }
        else slabsSum += price
        slabRows++
        rows.push(row)
      }
    }

    checks.push({
      label, profileId: owner, rowCount: count, stickerSum, reportedCardsTotal, bulk,
      reportedGrandTotal, slabRows, slabsSum, reportedSlabsTotal,
    })
  })

  flagDuplicates(rows)
  return { rows, checks, errors }
}

export function flagDuplicates(rows: ImportRow[]) {
  const seen = new Map<string, ImportRow>()
  for (const r of rows) {
    if (r.kind === 'bulk') continue
    const k = [r.profileId, r.name.toLowerCase(), r.cardNumber, r.variant, r.condition, r.gradingCompany, r.grade].join('|')
    const first = seen.get(k)
    if (first) {
      const msg = `Possible duplicate of ${first.source}`
      if (!r.notes.includes(msg)) r.notes.push(msg)
      const back = `Possible duplicate of ${r.source}`
      if (!first.notes.includes(back)) first.notes.push(back)
    } else seen.set(k, r)
  }
}
