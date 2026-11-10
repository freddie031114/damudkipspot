import { describe, expect, it } from 'vitest'
import {
  buildSalesLog, csvCell, filterLog, financialYearOf, financialYearStarting, profitPerCard, salesLogCsv, toCsv, totalsOf,
  type ReportSale,
} from './report'
import type { LineCost } from './show'

const known = (c: number): LineCost => ({ knownCostCents: c, unknownCostQty: 0, oversoldQty: 0 })
const unk: LineCost = { knownCostCents: 0, unknownCostQty: 1, oversoldQty: 0 }
const items = [
  { id: 'A', name: 'Charizard', setName: 'Base', cardNumber: '4/102', variant: '' },
  { id: 'B', name: 'Mew, "Gold"', setName: '', cardNumber: '', variant: '' },
]
const mk = (id: string, at: number, itemId: string, price: number, extra: Partial<ReportSale> = {}): ReportSale => ({
  id, soldAt: at, soldByProfileId: 'p1', showId: null, discountCents: 0, voidedAt: null,
  lines: [{ itemId, ownerProfileId: 'p2', qty: 1, stickerPriceCents: price, unitPriceCents: price }],
  payments: [{ method: 'cash', amountCents: price, receivedByProfileId: 'p1' }], ...extra,
})
const log = (sales: ReportSale[], costOf: (s: string, i: number) => LineCost = () => known(100)) =>
  buildSalesLog({ sales, items, showName: (id) => (id ? 'Brisbane show' : ''), costOf })

describe('sales log', () => {
  it('flattens sales to lines with revenue, cost and profit, newest first', () => {
    const rows = log([mk('s1', 1000, 'A', 500), mk('s2', 2000, 'B', 300)])
    expect(rows.map((r) => r.saleId)).toEqual(['s2', 's1'])
    expect(rows[1]).toMatchObject({ itemName: 'Charizard', revenueCents: 500, costCents: 100, profitCents: 400, owner: 'p2', soldBy: 'p1' })
  })

  it('shares a bundle discount across lines', () => {
    const s = mk('s1', 1, 'A', 600, {
      discountCents: 100,
      lines: [
        { itemId: 'A', ownerProfileId: 'p1', qty: 1, stickerPriceCents: 600, unitPriceCents: 600 },
        { itemId: 'B', ownerProfileId: 'p2', qty: 1, stickerPriceCents: 400, unitPriceCents: 400 },
      ],
      payments: [{ method: 'card', amountCents: 900, receivedByProfileId: 'p1' }],
    })
    const rows = log([s])
    expect(rows.reduce((n, r) => n + r.revenueCents, 0)).toBe(900)
  })

  it('leaves cost and profit empty when the stock cost is unknown', () => {
    const rows = log([mk('s1', 1, 'A', 500)], () => unk)
    expect(rows[0]).toMatchObject({ costCents: null, profitCents: null })
    expect(totalsOf(rows)).toMatchObject({ revenueCents: 500, unknownCostRevenueCents: 500, profitCents: 0 })
  })

  it('filters by owner, seller, show, dates, method and voided', () => {
    const rows = log([
      mk('s1', 1000, 'A', 500, { showId: 'show1' }),
      mk('s2', 2000, 'B', 300, { soldByProfileId: 'p2', payments: [{ method: 'payid', amountCents: 300, receivedByProfileId: 'p2' }] }),
      mk('s3', 3000, 'A', 400, { voidedAt: 5 }),
    ])
    expect(filterLog(rows, {}).map((r) => r.saleId)).toEqual(['s2', 's1'])
    expect(filterLog(rows, { includeVoided: true })).toHaveLength(3)
    expect(filterLog(rows, { showId: 'show1' }).map((r) => r.saleId)).toEqual(['s1'])
    expect(filterLog(rows, { showId: 'none' }).map((r) => r.saleId)).toEqual(['s2'])
    expect(filterLog(rows, { seller: 'p2' }).map((r) => r.saleId)).toEqual(['s2'])
    expect(filterLog(rows, { method: 'payid' }).map((r) => r.saleId)).toEqual(['s2'])
    expect(filterLog(rows, { from: 1500, to: 2500 }).map((r) => r.saleId)).toEqual(['s2'])
    expect(filterLog(rows, { owner: 'p1' })).toEqual([])
  })

  it('profit per card adds repeat sales and separates unknown-cost units', () => {
    const rows = log([mk('s1', 1, 'A', 500), mk('s2', 2, 'A', 700), mk('s3', 3, 'B', 300)], (id) => (id === 's3' ? unk : known(200)))
    const cards = profitPerCard(rows)
    expect(cards[0]).toMatchObject({ name: 'Charizard', qty: 2, revenueCents: 1200, costCents: 400, profitCents: 800 })
    expect(cards[1]).toMatchObject({ name: 'Mew, "Gold"', unknownCostQty: 1, profitCents: 0 })
  })
})

describe('Australian financial year', () => {
  it('runs 1 July to 30 June', () => {
    expect(financialYearOf(new Date(2025, 5, 30, 23, 59).getTime()).label).toBe('FY2024-25')
    expect(financialYearOf(new Date(2025, 6, 1, 0, 0).getTime()).label).toBe('FY2025-26')
    expect(financialYearOf(new Date(2026, 0, 15).getTime()).label).toBe('FY2025-26')
  })
  it('has an exclusive end at the next 1 July', () => {
    const fy = financialYearStarting(2025)
    expect(fy.start).toBe(new Date(2025, 6, 1).getTime())
    expect(fy.end).toBe(new Date(2026, 6, 1).getTime())
  })
})

describe('CSV', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })
  it('neutralises spreadsheet formulas in text but leaves numbers alone', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell(-12.5)).toBe('-12.5')
  })
  it('exports the sales log with dollar amounts and statuses', () => {
    const rows = log([mk('s1', new Date(2025, 8, 1, 14, 5).getTime(), 'B', 1234)], () => unk)
    const csv = salesLogCsv(rows, (p) => (p === 'p1' ? 'Freddie' : 'Ferrell'))
    const [head, line] = csv.trim().split('\r\n')
    expect(head).toContain('Revenue (AUD)')
    expect(line).toBe('2025-09-01 14:05,,Freddie,Ferrell,"Mew, ""Gold""",,,,1,12.34,12.34,12.34,,,cash,Cost unknown')
    expect(toCsv([['a', 1]])).toBe('a,1\r\n')
  })
})
