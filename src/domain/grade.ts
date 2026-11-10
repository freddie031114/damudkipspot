const SLAB = /^\s*(PSA|CGC|BGS|CCIC|ACE|SGC)\s*-?\s*(\d{1,2}(?:\.5)?)\s*$/i

/** Reads "PSA 9" style text from a condition field. Returns null for NM, LP and the like. */
export function parseGrade(text: string): { gradingCompany: string; grade: string } | null {
  const m = text.match(SLAB)
  return m ? { gradingCompany: m[1]!.toUpperCase(), grade: m[2]! } : null
}

/** The label to show on a slab, from its grader fields or, failing that, its condition text. */
export function slabLabel(item: { gradingCompany: string; grade: string; condition: string }): string | null {
  if (item.gradingCompany && item.grade) return `${item.gradingCompany} ${item.grade}`
  const g = parseGrade(item.condition)
  return g ? `${g.gradingCompany} ${g.grade}` : null
}
