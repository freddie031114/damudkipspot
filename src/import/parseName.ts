export interface ParsedName {
  name: string
  cardNumber: string
  qty: number
  variant: string
  condition: string
  language: string
  gradingCompany: string
  grade: string
  game: string
  notes: string[]
}

const TYPOS: Record<string, string> = {
  suicine: 'Suicune', gyrados: 'Gyarados', braxien: 'Braixen', palk: 'Palkia', etan: 'Ethan',
}
const SMALL = new Set(['and', 'of', 'the', 'de'])
const ONE_PIECE = ['whitebeard', 'kaido', 'xebec', 'luffy', 'zoro', 'shanks']

// A card number token: optional letters, optional hyphen, digits, optional "/other part".
const NUM = /^(?:[A-Za-z]{1,5})?-?\d{1,4}(?:\/(?:[A-Za-z]{1,5}-?)?[A-Za-z0-9-]{1,5})?$/

const cap = (w: string) => (w === w.toLowerCase() && !SMALL.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)

/** Splits messy sheet text like "Gengar TG06/TG30 LP" or "lucario SWSH 291 *8 35 each" into fields. */
export function parseCardName(raw: string): ParsedName {
  let s = raw.trim().replace(/\s+/g, ' ')
  const notes: string[] = []
  const variants: string[] = []
  let qty = 1
  let condition = ''
  let language = 'EN'
  let gradingCompany = ''
  let grade = ''
  let game = 'Pokémon'

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = s.match(re)
    if (m) {
      fn(m)
      s = s.replace(re, ' ').replace(/\s+/g, ' ').trim()
    }
  }

  take(/\s*\*\s*(\d+)(?:\s+\d+\s*each)?/i, (m) => { qty = Number(m[1]); notes.push(`Quantity ${qty} read from the name`) })
  take(/\(?\bsealed\b\)?/i, () => variants.push('Sealed promo'))
  take(/\b(PSA|CGC|BGS|CCIC|ACE|SGC)\s*-?\s*(\d{1,2}(?:\.5)?)\b/i, (m) => { gradingCompany = m[1]!.toUpperCase(); grade = m[2]! })
  take(/(?:^|\s)(NM-?|LP|MP|HP|DMG)(?=\s|$)/, (m) => { condition = m[1]! })
  take(/(?:^|\s)(JP|JPN)(?=\s|$)/i, () => { language = 'JA' })
  take(/(?:^|\s)eb games(?=\s|$)/i, () => variants.push('EB Games'))
  take(/(?:^|\s)(stamped|alt|promo)(?=\s|$)/i, (m) => variants.push(m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()))

  const tokens = s.split(' ').filter(Boolean)
  let cardNumber = ''
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!
    if (!/\d/.test(t) || !NUM.test(t)) continue
    const dashed = t.match(/^([A-Za-z]+)-(\d+)$/)
    if (dashed && dashed[1]!.length > 3) {
      tokens[i] = dashed[1]!
      cardNumber = dashed[2]!
    } else {
      tokens.splice(i, 1)
      cardNumber = t.replace(/^-/, '').toUpperCase()
      // "SWSH 291": a short all-caps prefix word belongs to the number.
      const prev = tokens[i - 1]
      if (prev && /^[A-Z]{2,5}$/.test(prev) && /^\d+$/.test(cardNumber)) {
        cardNumber = prev + cardNumber
        tokens.splice(i - 1, 1)
      }
    }
    break
  }

  let name = tokens.join(' ').replace(/\s+no\.?$/i, '').replace(/[\s,;-]+$/, '')
  name = name.split(' ').map((w) => {
    const fixed = TYPOS[w.toLowerCase()]
    if (fixed) { notes.push(`Typo fixed: ${w} → ${fixed}`); return fixed }
    return cap(w)
  }).join(' ')

  const lower = name.toLowerCase()
  if (ONE_PIECE.some((k) => lower.includes(k))) { game = 'One Piece'; notes.push('Game guessed as One Piece from the name: check') }
  else if (lower.startsWith('loki')) { game = 'Other'; notes.push('Unknown game (Loki?): check') }

  if (!cardNumber && !gradingCompany && !variants.includes('Sealed promo')) notes.push('No card number')

  return { name, cardNumber, qty, variant: variants.join(' '), condition, language, gradingCompany, grade, game, notes }
}
