import { parseMoney } from '../domain/money'
import type { ProfileId } from '../data/types'
import { flagDuplicates } from './sheet'
import type { ImportRow } from './types'

export type Field = 'name' | 'setName' | 'cardNumber' | 'language' | 'variant' | 'condition' | 'grade' | 'qty' | 'cost' | 'market' | 'location' | 'game'
export type Mapping = Partial<Record<Field, number>>

export const FIELDS: { id: Field; label: string; required?: boolean }[] = [
  { id: 'name', label: 'Name', required: true }, { id: 'market', label: 'Market price' }, { id: 'qty', label: 'Quantity' },
  { id: 'cost', label: 'Cost each' }, { id: 'setName', label: 'Set' }, { id: 'cardNumber', label: 'Card number' },
  { id: 'language', label: 'Language' }, { id: 'variant', label: 'Variant / finish' }, { id: 'condition', label: 'Condition' },
  { id: 'grade', label: 'Grade (e.g. PSA 10)' }, { id: 'location', label: 'Location' }, { id: 'game', label: 'Game' },
]

// Header patterns, including the column names Collectr exports are believed to use.
// Collectr's real export has not been checked yet, so the mapping step always lets you correct these.
const GUESS: [Field, RegExp][] = [
  ['name', /^(product\s*name|card\s*name|name|item|title|product)$/i],
  ['market', /^(market\s*price|current\s*price|price|value|market)\b/i],
  ['qty', /^(qty|quantity|count|owned)$/i],
  ['cost', /(average\s*cost|cost\s*paid|purchase\s*price|cost)/i],
  ['setName', /^(set(\s*name)?|expansion|series)$/i],
  ['cardNumber', /(card\s*number|^number$|^no\.?$|^#$)/i],
  ['language', /lang/i],
  ['variant', /^(variance|variant|finish|printing|edition)$/i],
  ['condition', /condition/i],
  ['grade', /^(grade|grading)$/i],
  ['location', /(location|binder|box|storage)/i],
  ['game', /^(game|tcg|category)$/i],
]

export function guessMapping(headers: string[]): Mapping {
  const m: Mapping = {}
  const used = new Set<number>()
  for (const [field, re] of GUESS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h.trim()))
    if (i >= 0) {
      m[field] = i
      used.add(i)
    }
  }
  return m
}

export interface GenericOptions {
  profileId: ProfileId
  /** Multiplier applied to prices, e.g. 1.55 to convert USD to AUD. 1 when already AUD. */
  rate: number
}

export function parseGeneric(grid: string[][], mapping: Mapping, opts: GenericOptions): { rows: ImportRow[]; errors: string[] } {
  const errors: string[] = []
  if (mapping.name === undefined) return { rows: [], errors: ['Choose which column holds the name.'] }
  if (!(opts.rate > 0)) return { rows: [], errors: ['The price multiplier must be greater than zero.'] }
  const rows: ImportRow[] = []
  const cell = (r: string[], f: Field) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim())
  const price = (s: string) => {
    const c = parseMoney(s)
    return c === null ? null : Math.round(c * opts.rate)
  }
  grid.slice(1).forEach((r, i) => {
    const name = cell(r, 'name')
    if (!name) return
    const row: ImportRow = {
      key: `g-${i}`, profileId: opts.profileId, include: true, kind: 'single', game: cell(r, 'game') || 'Pokémon', name,
      setName: cell(r, 'setName'), cardNumber: cell(r, 'cardNumber'), language: cell(r, 'language') || 'EN',
      variant: cell(r, 'variant'), condition: cell(r, 'condition'), gradingCompany: '', grade: '', qty: 1,
      marketCents: null, stickerOverrideCents: null, costCents: null, location: cell(r, 'location'), notes: [],
      source: `Row ${i + 2}`, blocking: [],
    }
    const q = cell(r, 'qty')
    if (q !== '') {
      const n = Number(q)
      if (Number.isInteger(n) && n >= 1) row.qty = n
      else {
        row.blocking.push(`Bad quantity "${q}"`)
        row.include = false
      }
    }
    const g = cell(r, 'grade').match(/^(PSA|CGC|BGS|CCIC|ACE|SGC)?\s*-?\s*(\d{1,2}(?:\.5)?)$/i)
    if (g) {
      row.gradingCompany = (g[1] ?? '').toUpperCase()
      row.grade = g[2]!
      row.kind = 'graded'
    }
    const m = cell(r, 'market')
    row.marketCents = price(m)
    if (row.marketCents === null) {
      row.include = false
      row.blocking.push(m === '' ? 'No market price' : `Could not read price "${m}"`)
    }
    const c = cell(r, 'cost')
    if (c !== '') {
      const cc = price(c)
      if (cc === null) row.notes.push(`Cost "${c}" not understood: left blank`)
      else row.costCents = cc
    }
    rows.push(row)
  })
  if (rows.length === 0) errors.push('No rows with a name were found.')
  flagDuplicates(rows)
  return { rows, errors }
}
