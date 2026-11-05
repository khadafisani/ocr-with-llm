// Parses amounts printed in either "1.234.567,89" (ID/EU) or "1,234,567.89" (US) style.
export function parseNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let s = String(value).trim()
  if (!s) return null

  // Trailing "-" is not negative: "Rp 10.000,-" is a common Indonesian notation.
  const negative = /^\(.*\)$/.test(s) || /^-\s*\d/.test(s)
  s = s.replace(/[^\d.,]/g, '')
  if (!/\d/.test(s)) return null

  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: whichever comes last is the decimal separator.
    const dec = lastDot > lastComma ? '.' : ','
    const thou = dec === '.' ? ',' : '.'
    s = s.split(thou).join('').replace(dec, '.')
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ','
    const parts = s.split(sep)
    // "1.500.000" or "1,500" (exactly 3 trailing digits) -> thousands separator.
    const isThousands = parts.length > 2 || parts[parts.length - 1]!.length === 3
    s = isThousands ? parts.join('') : parts.join('.')
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2, pebruari: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
}

function makeDate(y: number, m: number, d: number): Date | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCMonth() === m - 1 ? date : null
}

// Accepts ISO dates, day-first numeric dates (dd/mm/yyyy) and "12 Januari 2026" / "Jan 12, 2026".
export function parseDate(...candidates: (string | null | undefined)[]): Date | null {
  for (const raw of candidates) {
    if (!raw) continue
    const s = raw.trim().toLowerCase()
    let m: RegExpMatchArray | null

    if ((m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
      const d = makeDate(+m[1]!, +m[2]!, +m[3]!)
      if (d) return d
    }
    if ((m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
      const d = makeDate(+m[3]!, +m[2]!, +m[1]!)
      if (d) return d
    }
    if ((m = s.match(/(\d{1,2})[\s-]+([a-z]+)\.?[\s-,]+(\d{2,4})/)) && MONTHS[m[2]!]) {
      const d = makeDate(+m[3]!, MONTHS[m[2]!]!, +m[1]!)
      if (d) return d
    }
    if ((m = s.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{2,4})/)) && MONTHS[m[1]!]) {
      const d = makeDate(+m[3]!, MONTHS[m[1]!]!, +m[2]!)
      if (d) return d
    }
  }
  return null
}

export function cleanString(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}
