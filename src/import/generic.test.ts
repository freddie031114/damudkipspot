import { describe, expect, it } from 'vitest'
import { checkMessages } from './checks'
import { parseTable } from './csv'
import { guessMapping, parseGeneric } from './generic'
import { readFileSync } from 'node:fs'
import { parseSheetGrid } from './sheet'

const csv = [
  'Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price (As of 2025-01-01)',
  'Main,Pokemon,Obsidian Flames,Charizard ex,125/197,Double Rare,Holofoil,,Near Mint,"$40.00",2,"$60.00"',
  'Main,Pokemon,Base Set,Blastoise,2/102,Rare,Holofoil,PSA 9,,,1,"$1,200.50"',
  'Main,Pokemon,Base Set,Mystery,0/0,Rare,,,,,1,N/A',
  'Main,Pokemon,Base Set,Pikachu,58/102,Common,,,,,0,$5',
].join('\n')

describe('generic import', () => {
  const grid = parseTable(csv)
  it('guesses columns from Collectr-style headers', () => {
    const m = guessMapping(grid[0]!)
    expect(m).toMatchObject({ name: 3, setName: 2, cardNumber: 4, variant: 6, grade: 7, condition: 8, cost: 9, qty: 10, market: 11, game: 1 })
  })
  it('reads rows, converts currency, and flags bad prices and quantities', () => {
    const { rows } = parseGeneric(grid, guessMapping(grid[0]!), { profileId: 'p1', rate: 1.5 })
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ name: 'Charizard ex', qty: 2, marketCents: 9000, costCents: 6000, include: true })
    expect(rows[1]).toMatchObject({ kind: 'graded', gradingCompany: 'PSA', grade: '9', marketCents: 180075 })
    expect(rows[2]).toMatchObject({ include: false, blocking: ['Could not read price "N/A"'] })
    expect(rows[3]).toMatchObject({ include: false })
    expect(rows[3]!.blocking[0]).toContain('quantity')
  })
  it('needs a name column', () => {
    expect(parseGeneric(grid, {}, { profileId: 'p1', rate: 1 }).errors[0]).toContain('name')
  })
})

describe('checkMessages on the real sheet', () => {
  it('explains the $240 slab gap in plain English and passes the rest', () => {
    const result = parseSheetGrid(parseTable(readFileSync(new URL('./sheet.fixture.csv', import.meta.url), 'utf8')))
    const msgs = checkMessages(result.checks, (p) => (p === 'p1' ? 'Freddie' : 'Ferrell'))
    const bad = msgs.filter((m) => !m.ok)
    expect(bad).toHaveLength(1)
    expect(bad[0]!.text).toContain('$15,710')
    expect(bad[0]!.text).toContain('$15,470')
    expect(bad[0]!.text).toContain('$240')
    expect(msgs.filter((m) => m.ok).length).toBeGreaterThanOrEqual(4)
  })
})
