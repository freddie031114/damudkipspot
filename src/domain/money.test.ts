import { describe, expect, it } from 'vitest'
import { formatAud, parseMoney } from './money'

describe('parseMoney', () => {
  it.each([
    ['$100', 10000],
    ['$1,240', 124000],
    ['30$', 3000],
    ['$32.00', 3200],
    ['1750', 175000],
    [' $ 9.5 ', 950],
    ['$1.005', 101],
  ])('parses %s', (input, cents) => expect(parseMoney(input)).toBe(cents))
  it.each(['', 'abc', '$', '1.2.3', null, undefined])('rejects %s', (input) =>
    expect(parseMoney(input as string)).toBeNull(),
  )
  it('formats AUD', () => expect(formatAud(124000)).toBe('$1,240.00'))
})
