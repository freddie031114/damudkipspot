export type StickerRounding = 'none' | '50c' | '1' | '5'

const UNIT_CENTS: Record<StickerRounding, number> = { none: 1, '50c': 50, '1': 100, '5': 500 }

export const DEFAULT_MULTIPLIER_PERMILLE = 1100 // 1.10x
export const DEFAULT_ROUNDING: StickerRounding = '1'

/**
 * Sticker price = market x multiplier, rounded half-up to the rounding unit.
 * The multiplier is stored in thousandths (1100 = 1.10x) so all arithmetic is integer.
 */
export function stickerFromMarket(
  marketCents: number,
  multiplierPermille: number = DEFAULT_MULTIPLIER_PERMILLE,
  rounding: StickerRounding = DEFAULT_ROUNDING,
): number {
  const unit = UNIT_CENTS[rounding]
  const num = marketCents * multiplierPermille
  const den = 1000 * unit
  return Math.floor((2 * num + den) / (2 * den)) * unit
}

/** The price to show/charge: a manual override wins over the computed sticker. */
export function effectiveSticker(
  item: { marketPriceCents: number; stickerOverrideCents?: number | null },
  multiplierPermille?: number,
  rounding?: StickerRounding,
): number {
  return item.stickerOverrideCents ?? stickerFromMarket(item.marketPriceCents, multiplierPermille, rounding)
}
