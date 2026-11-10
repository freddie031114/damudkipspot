import type { ProfileId } from '../data/types'
import { formatAud } from '../domain/money'
import type { BlockCheck } from './types'

export interface CheckMessage {
  ok: boolean
  text: string
}

const fmt = (c: number) => formatAud(c).replace('.00', '')

/** Plain-English cross-checks of the parsed sheet against the totals printed in it. */
export function checkMessages(checks: BlockCheck[], nameOf: (p: ProfileId) => string): CheckMessage[] {
  const out: CheckMessage[] = []
  for (const c of checks) {
    const who = `${c.label} (${nameOf(c.profileId)})`
    if (c.reportedCardsTotal !== null) {
      const diff = c.stickerSum - c.reportedCardsTotal
      out.push(
        Math.abs(diff) <= 100
          ? { ok: true, text: `${who}: ${c.rowCount} cards. Sticker column adds to ${fmt(c.stickerSum)}; the sheet's total says ${fmt(c.reportedCardsTotal)}${diff ? ' (within rounding)' : ''}.` }
          : { ok: false, text: `${who}: ${c.rowCount} cards. Sticker column adds to ${fmt(c.stickerSum)} but the sheet's total says ${fmt(c.reportedCardsTotal)} (${fmt(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}). Check for a missing or changed row.` },
      )
    } else out.push({ ok: true, text: `${who}: ${c.rowCount} cards (no printed total to compare).` })
    if (c.bulk !== null) out.push({ ok: true, text: `${who}: bulk figure ${fmt(c.bulk)} imported as one lump-sum item.` })
    if (c.slabRows > 0) {
      const diff = c.reportedSlabsTotal === null ? 0 : c.slabsSum - c.reportedSlabsTotal
      out.push(
        diff === 0
          ? { ok: true, text: `${who}: ${c.slabRows} slabs add to ${fmt(c.slabsSum)}, matching the sheet.` }
          : { ok: false, text: `${who}: ${c.slabRows} slabs add to ${fmt(c.slabsSum)} but the sheet's slab total says ${fmt(c.reportedSlabsTotal!)} (${fmt(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}). The import uses the individual prices.` },
      )
    }
  }
  return out
}
