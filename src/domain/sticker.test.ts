import { describe, expect, it } from 'vitest'
import { effectiveSticker, stickerFromMarket } from './sticker'

// Market -> sticker pairs taken from the existing spreadsheet (nearest $1 default).
const sheet: Array<[number, number]> = [
  [100, 110], [70, 77], [320, 352], [150, 165], [164, 180], [410, 451], [41, 45],
  [1240, 1364], [750, 825], [75, 83], [30, 33], [20, 22], [256, 282], [27, 30],
  [23, 25], [95, 105],
]

describe('stickerFromMarket', () => {
  it.each(sheet)('market $%s -> sticker $%s (default 1.1x, nearest $1)', (m, s) => {
    expect(stickerFromMarket(m * 100)).toBe(s * 100)
  })
  it('rounds half up at exactly .50 (no float drift)', () => {
    expect(stickerFromMarket(7500)).toBe(8300) // 82.50 -> 83
    expect(stickerFromMarket(13500)).toBe(14900) // 148.50 -> 149
  })
  it('supports other rounding modes', () => {
    expect(stickerFromMarket(3500, 1100, '5')).toBe(4000) // 38.50 -> 40 (the sheet's $5 style)
    expect(stickerFromMarket(3500, 1100, 'none')).toBe(3850)
    expect(stickerFromMarket(3500, 1100, '50c')).toBe(3850)
  })
  it('manual override wins and clearing it returns to computed', () => {
    expect(effectiveSticker({ marketPriceCents: 3500, stickerOverrideCents: 4000 })).toBe(4000)
    expect(effectiveSticker({ marketPriceCents: 3500, stickerOverrideCents: null })).toBe(3900)
  })
})
