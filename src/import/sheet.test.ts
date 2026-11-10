import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTable } from './csv'
import { parseCardName } from './parseName'
import { parseSheetGrid } from './sheet'

const grid = parseTable(readFileSync(new URL('./sheet.fixture.csv', import.meta.url), 'utf8'))
const result = parseSheetGrid(grid)
const find = (name: string, owner?: string) => result.rows.find((r) => r.name === name && (!owner || r.profileId === owner))!

describe('parseCardName', () => {
  it.each([
    ['Gengar TG06/TG30 LP', { name: 'Gengar', cardNumber: 'TG06/TG30', condition: 'LP' }],
    ['Dialga PSA10 Origin', { name: 'Dialga Origin', gradingCompany: 'PSA', grade: '10' }],
    ['CCIC 10  GLACEON', { name: 'GLACEON', gradingCompany: 'CCIC', grade: '10' }],
    ['Shaymin JP PSA 10', { name: 'Shaymin', language: 'JA', gradingCompany: 'PSA' }],
    ['Jolteon 7/113 Stamped', { name: 'Jolteon', cardNumber: '7/113', variant: 'Stamped' }],
    ['lucario SWSH 291 *8 35 each', { name: 'Lucario', cardNumber: 'SWSH291', qty: 8 }],
    ['eevee 196/sv-p', { name: 'Eevee', cardNumber: '196/SV-P' }],
    ['loki -119', { name: 'Loki', cardNumber: '119', game: 'Other' }],
    ['rocks d xebec-118', { name: 'Rocks D Xebec', cardNumber: '118', game: 'One Piece' }],
    ['steelix no 208', { name: 'Steelix', cardNumber: '208' }],
    ['suicine eb games', { name: 'Suicune', variant: 'EB Games' }],
    ['Gold Star Greninja (sealed)', { name: 'Gold Star Greninja', variant: 'Sealed promo' }],
    ['N\'s Reshiram 167/159 Sealed', { name: "N's Reshiram", cardNumber: '167/159', variant: 'Sealed promo' }],
    ['Gold Star Umbreon NM-', { name: 'Gold Star Umbreon', condition: 'NM-' }],
    ['Leafeon Lv.42 DPBP158', { name: 'Leafeon Lv.42', cardNumber: 'DPBP158' }],
    ['shining ho oh sm70', { name: 'Shining Ho Oh', cardNumber: 'SM70' }],
    ['Slowpoke and Psyduck 096/094', { name: 'Slowpoke and Psyduck', cardNumber: '096/094' }],
  ])('%s', (raw, expected) => expect(parseCardName(raw)).toMatchObject(expected))
})

describe('the real spreadsheet', () => {
  it('finds both blocks and assigns left to Ferrell (p2) and right to Freddie (p1)', () => {
    expect(result.errors).toEqual([])
    expect(result.checks.map((c) => c.profileId)).toEqual(['p2', 'p1'])
  })

  it('reads every card row, slab and bulk figure', () => {
    const [left, right] = result.checks
    expect(left!.rowCount).toBe(47)
    expect(right!.rowCount).toBe(52)
    expect(left!.slabRows).toBe(15)
    expect(left!.bulk).toBe(175000)
    expect(right!.bulk).toBe(125400)
    expect(result.rows.filter((r) => r.kind === 'bulk')).toHaveLength(2)
  })

  it('adds up to the totals printed in the sheet (they are sticker totals, within $1 of rounding)', () => {
    const [left, right] = result.checks
    expect(Math.abs(left!.stickerSum - left!.reportedCardsTotal!)).toBeLessThanOrEqual(100)
    expect(right!.stickerSum).toBe(right!.reportedCardsTotal)
    expect(left!.reportedGrandTotal).toBe(left!.reportedCardsTotal! + left!.bulk!)
    expect(right!.reportedGrandTotal).toBe(right!.reportedCardsTotal! + right!.bulk!)
  })

  it('finds that the sheet slab total is $240 lower than its own 15 slabs (Ethan Adventure, the first row)', () => {
    const left = result.checks[0]!
    expect(left.slabsSum).toBe(1571000)
    expect(left.reportedSlabsTotal).toBe(1547000)
    expect(left.slabsSum - left.reportedSlabsTotal!).toBe(24000)
  })

  it('handles the quantity row: 8 cards at $32 market, sticker computed to $35', () => {
    const l = find('Lucario')
    expect(l).toMatchObject({ qty: 8, marketCents: 3200, cardNumber: 'SWSH291', stickerOverrideCents: null })
  })

  it('parses odd prices like 30$ and keeps real sticker differences as overrides', () => {
    expect(find('Mew', 'p2')).toMatchObject({ marketCents: 3000, stickerOverrideCents: null })
    expect(find('Arbok')).toMatchObject({ marketCents: 3500, stickerOverrideCents: 4000 })
    expect(find('Serperior')).toMatchObject({ marketCents: 4100, stickerOverrideCents: null }) // $45.10 is just unrounded 1.1x
  })

  it('imports slabs as graded items with the price as market', () => {
    const s = result.rows.find((r) => r.name.startsWith('Charizard 20th'))!
    expect(s).toMatchObject({ kind: 'graded', gradingCompany: 'PSA', grade: '10', marketCents: 560000, profileId: 'p2' })
  })

  it('flags the duplicate Gold Star Greninja rows rather than merging them', () => {
    const dupes = result.rows.filter((r) => r.name === 'Gold Star Greninja')
    expect(dupes).toHaveLength(2)
    expect(dupes.every((d) => d.notes.some((n) => n.startsWith('Possible duplicate')))).toBe(true)
    expect(dupes.every((d) => d.include)).toBe(true)
  })

  it('has no blocking problems, and every row has a market price', () => {
    expect(result.rows.filter((r) => r.blocking.length)).toEqual([])
    expect(result.rows.every((r) => r.marketCents !== null)).toBe(true)
  })

  it('imports Ferrell at $6,961 cards + $1,750 bulk + $15,710 slabs market value', () => {
    const sum = (p: string) => result.rows.filter((r) => r.profileId === p).reduce((n, r) => n + r.qty * (r.marketCents ?? 0), 0)
    expect(sum('p2')).toBe(696100 + 175000 + 1571000)
    expect(sum('p1')).toBe(357000 + 125400)
  })
})
