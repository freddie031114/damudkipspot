/** Money is integer cents (AUD). Never use floats for stored values. */

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

export function formatAud(cents: number): string {
  return aud.format(cents / 100)
}

/**
 * Parse messy price text into cents. Accepts "$1,240", "30$", "$32.00", "1750", " $ 9.5 ".
 * Returns null when there is no usable number.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null
  const cleaned = input.replace(/[\s$,]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  // Round via string math on cents to avoid binary float drift (e.g. 1.005).
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.')
  const cents = Number(whole) * 100 + Math.round(Number(`0.${frac || '0'}`) * 100)
  return cleaned.startsWith('-') ? -cents : cents
}
