import { describe, expect, it } from 'vitest'
import { parseGrade, slabLabel } from './grade'

describe('slab grades', () => {
  it.each([
    ['PSA 9', 'PSA', '9'],
    ['psa10', 'PSA', '10'],
    ['BGS 9.5', 'BGS', '9.5'],
    [' CGC-10 ', 'CGC', '10'],
  ])('reads %s', (text, company, grade) => expect(parseGrade(text)).toEqual({ gradingCompany: company, grade }))

  it.each(['NM', 'LP', 'near mint', '', 'PSA', 'PSA 100'])('ignores %s', (text) => expect(parseGrade(text)).toBeNull())

  it('labels a slab from its fields, or from the condition when the fields are empty', () => {
    expect(slabLabel({ gradingCompany: 'PSA', grade: '10', condition: '' })).toBe('PSA 10')
    expect(slabLabel({ gradingCompany: '', grade: '', condition: 'PSA 9' })).toBe('PSA 9')
    expect(slabLabel({ gradingCompany: '', grade: '', condition: 'LP' })).toBeNull()
  })
})
