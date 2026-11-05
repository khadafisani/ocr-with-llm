import { describe, expect, test } from 'bun:test'
import { parseDate, parseNumber } from './normalize'

describe('parseNumber', () => {
  test.each([
    ['Rp 1.129.425', 1129425],
    ['Rp 10.000,-', 10000],
    ['1.234.567,89', 1234567.89],
    ['1,234,567.89', 1234567.89],
    ['$ 1,500', 1500],
    ['12,5', 12.5],
    ['3.75', 3.75],
    ['(2.000)', -2000],
    ['-15', -15],
    [42, 42],
    ['', null],
    ['n/a', null],
    [null, null],
  ])('%p -> %p', (input, expected) => {
    expect(parseNumber(input)).toBe(expected)
  })
})

describe('parseDate', () => {
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null
  test.each([
    ['2026-10-15', '2026-10-15'],
    ['15/10/2026', '2026-10-15'],
    ['15-10-26', '2026-10-15'],
    ['15 Oktober 2026', '2026-10-15'],
    ['1 Agustus 2026', '2026-08-01'],
    ['Oct 15, 2026', '2026-10-15'],
    ['31/02/2026', null],
    ['no date', null],
  ])('%p -> %p', (input, expected) => {
    expect(iso(parseDate(input))).toBe(expected)
  })

  test('falls back to the next candidate', () => {
    expect(iso(parseDate(null, 'garbage', '15 Okt 2026'))).toBe('2026-10-15')
  })
})
