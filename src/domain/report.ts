import type { PaymentMethod, ProfileId, SaleLine, SalePayment } from './sale'
import { allocate, type LineCost } from './show'

export interface ReportSale {
  id: string
  soldAt: number
  soldByProfileId: ProfileId
  showId: string | null
  discountCents: number
  lines: SaleLine[]
  payments: SalePayment[]
  voidedAt: number | null
}

export interface ReportItem {
  id: string
  name: string
  setName: string
  cardNumber: string
  variant: string
}

export interface LogRow {
  saleId: string
  soldAt: number
  showId: string | null
  showName: string
  soldBy: ProfileId
  owner: ProfileId
  itemId: string
  itemName: string
  setName: string
  cardNumber: string
  variant: string
  qty: number
  stickerCents: number
  unitPriceCents: number
  /** Revenue for this line after any bundle discount. */
  revenueCents: number
  /** Cost of goods; null when any of the stock sold has no recorded cost. */
  costCents: number | null
  profitCents: number | null
  methods: PaymentMethod[]
  voided: boolean
}

export function buildSalesLog(input: {
  sales: ReportSale[]
  items: ReportItem[]
  showName: (id: string | null) => string
  costOf: (saleId: string, lineIndex: number) => LineCost
}): LogRow[] {
  const items = new Map(input.items.map((i) => [i.id, i]))
  const rows: LogRow[] = []
  for (const s of input.sales) {
    const lineTotals = s.lines.map((l) => l.qty * l.unitPriceCents)
    const total = lineTotals.reduce((a, b) => a + b, 0) - s.discountCents
    const rev = allocate(total, lineTotals)
    const methods = [...new Set(s.payments.map((p) => p.method))]
    s.lines.forEach((l, i) => {
      const it = items.get(l.itemId)
      const c = input.costOf(s.id, i)
      const costKnown = c.unknownCostQty === 0 && c.oversoldQty === 0
      rows.push({
        saleId: s.id, soldAt: s.soldAt, showId: s.showId, showName: input.showName(s.showId), soldBy: s.soldByProfileId,
        owner: l.ownerProfileId, itemId: l.itemId, itemName: it?.name ?? '(deleted item)', setName: it?.setName ?? '',
        cardNumber: it?.cardNumber ?? '', variant: it?.variant ?? '', qty: l.qty, stickerCents: l.stickerPriceCents,
        unitPriceCents: l.unitPriceCents, revenueCents: rev[i]!, costCents: costKnown ? c.knownCostCents : null,
        profitCents: costKnown ? rev[i]! - c.knownCostCents : null, methods, voided: s.voidedAt !== null,
      })
    })
  }
  return rows.sort((a, b) => b.soldAt - a.soldAt)
}

export interface LogFilter {
  owner?: ProfileId | 'all'
  seller?: ProfileId | 'all'
  /** A show id, 'none' for sales outside any show, or 'all'. */
  showId?: string
  from?: number
  /** Exclusive end. */
  to?: number
  method?: PaymentMethod | 'all'
  includeVoided?: boolean
}

export function filterLog(rows: LogRow[], f: LogFilter): LogRow[] {
  return rows.filter((r) => {
    if (r.voided && !f.includeVoided) return false
    if (f.owner && f.owner !== 'all' && r.owner !== f.owner) return false
    if (f.seller && f.seller !== 'all' && r.soldBy !== f.seller) return false
    if (f.showId && f.showId !== 'all' && (f.showId === 'none' ? r.showId !== null : r.showId !== f.showId)) return false
    if (f.from !== undefined && r.soldAt < f.from) return false
    if (f.to !== undefined && r.soldAt >= f.to) return false
    if (f.method && f.method !== 'all' && !r.methods.includes(f.method)) return false
    return true
  })
}

export interface CardProfit {
  itemId: string
  name: string
  qty: number
  revenueCents: number
  /** Cost of lines with known cost. */
  costCents: number
  /** Profit on lines with known cost only. */
  profitCents: number
  /** Units sold whose cost is not recorded (kept out of profit). */
  unknownCostQty: number
}

export function profitPerCard(rows: LogRow[]): CardProfit[] {
  const m = new Map<string, CardProfit>()
  for (const r of rows) {
    if (r.voided) continue
    const c = m.get(r.itemId) ?? { itemId: r.itemId, name: r.itemName, qty: 0, revenueCents: 0, costCents: 0, profitCents: 0, unknownCostQty: 0 }
    c.qty += r.qty
    c.revenueCents += r.revenueCents
    if (r.costCents === null) c.unknownCostQty += r.qty
    else {
      c.costCents += r.costCents
      c.profitCents += r.profitCents ?? 0
    }
    m.set(r.itemId, c)
  }
  return [...m.values()].sort((a, b) => b.profitCents - a.profitCents || a.name.localeCompare(b.name))
}

export interface LogTotals {
  revenueCents: number
  costCents: number
  profitCents: number
  unknownCostRevenueCents: number
  count: number
}

export function totalsOf(rows: LogRow[]): LogTotals {
  const t: LogTotals = { revenueCents: 0, costCents: 0, profitCents: 0, unknownCostRevenueCents: 0, count: 0 }
  for (const r of rows) {
    if (r.voided) continue
    t.count++
    t.revenueCents += r.revenueCents
    if (r.costCents === null) t.unknownCostRevenueCents += r.revenueCents
    else {
      t.costCents += r.costCents
      t.profitCents += r.profitCents ?? 0
    }
  }
  return t
}

// ---------- Australian financial year (1 July to 30 June) ----------

export interface FinancialYear {
  label: string
  start: number
  /** Exclusive: midnight on 1 July of the next year. */
  end: number
}

export function financialYearOf(ts: number): FinancialYear {
  const d = new Date(ts)
  const startYear = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1
  return financialYearStarting(startYear)
}

export function financialYearStarting(startYear: number): FinancialYear {
  return {
    label: `FY${startYear}-${String(startYear + 1).slice(2)}`,
    start: new Date(startYear, 6, 1).getTime(),
    end: new Date(startYear + 1, 6, 1).getTime(),
  }
}

// ---------- CSV ----------

/**
 * One CSV cell. Text starting with = + - @ is prefixed so spreadsheets never run it as a
 * formula (names and notes come from users and imports). Numbers are written as-is.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows: (string | number | null | undefined)[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

const dollars = (c: number) => (c / 100).toFixed(2)
const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function salesLogCsv(rows: LogRow[], nameOf: (p: ProfileId) => string): string {
  const head = ['Date', 'Show', 'Sold by', 'Stock owner', 'Item', 'Set', 'Number', 'Variant', 'Qty', 'Sticker each (AUD)', 'Price each (AUD)', 'Revenue (AUD)', 'Cost (AUD)', 'Profit (AUD)', 'Payment', 'Status']
  const body = rows.map((r) => [
    localDate(r.soldAt), r.showName, nameOf(r.soldBy), nameOf(r.owner), r.itemName, r.setName, r.cardNumber, r.variant, r.qty,
    dollars(r.stickerCents), dollars(r.unitPriceCents), dollars(r.revenueCents),
    r.costCents === null ? '' : dollars(r.costCents), r.profitCents === null ? '' : dollars(r.profitCents),
    r.methods.join('+'), r.voided ? 'Voided' : r.costCents === null ? 'Cost unknown' : 'OK',
  ])
  return toCsv([head, ...body])
}
