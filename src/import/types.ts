import type { ProfileId } from '../data/types'

export interface ImportRow {
  key: string
  profileId: ProfileId
  include: boolean
  kind: 'single' | 'graded' | 'bulk' | 'sealed' | 'other'
  game: string
  name: string
  setName: string
  cardNumber: string
  language: string
  variant: string
  condition: string
  gradingCompany: string
  grade: string
  qty: number
  /** Per-unit market price in cents. */
  marketCents: number | null
  /** Manual sticker only when the sheet's sticker differs from market x 1.1. */
  stickerOverrideCents: number | null
  /** Price on the physical sticker, when the source says (the sheet's sticker column). */
  stickeredCents: number | null
  /** Per-unit cost in cents; null when unknown (opening stock). */
  costCents: number | null
  location: string
  notes: string[]
  /** Where the row came from, e.g. "Left block, row 5". */
  source: string
  /** Problems that should stop a row being imported until fixed. */
  blocking: string[]
}

export interface BlockCheck {
  label: string
  profileId: ProfileId
  rowCount: number
  /** Sum of the sheet's sticker column for card rows (what the sheet's Total adds up). */
  stickerSum: number
  reportedCardsTotal: number | null
  bulk: number | null
  reportedGrandTotal: number | null
  slabRows: number
  slabsSum: number
  reportedSlabsTotal: number | null
}

export interface SheetResult {
  rows: ImportRow[]
  checks: BlockCheck[]
  errors: string[]
}
