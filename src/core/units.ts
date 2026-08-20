import type { DisplayUnits } from './model'

export const MM_PER_INCH = 25.4

export function unitLabel(units: DisplayUnits) {
  return units === 'mm' ? 'mm' : 'in'
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

export function formatFractionalInches(mm: number, denominator = 16) {
  const sign = mm < 0 ? '-' : ''
  let totalSixteenths = Math.round(Math.abs(mm) / MM_PER_INCH * denominator)
  const whole = Math.floor(totalSixteenths / denominator)
  totalSixteenths %= denominator
  if (!totalSixteenths) return `${sign}${whole}`
  const divisor = gcd(totalSixteenths, denominator)
  const fraction = `${totalSixteenths / divisor}/${denominator / divisor}`
  return `${sign}${whole ? `${whole} ` : ''}${fraction}`
}

export function formatLengthInput(mm: number, units: DisplayUnits) {
  if (units === 'in-decimal') return (mm / MM_PER_INCH).toFixed(3)
  if (units === 'in-fractional') return formatFractionalInches(mm)
  const rounded = Math.round(mm * 10_000) / 10_000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function formatLength(mm: number, units: DisplayUnits) {
  if (units === 'in-decimal') return `${formatLengthInput(mm, units)} in`
  if (units === 'in-fractional') return `${formatLengthInput(mm, units)}\u2033`
  return `${formatLengthInput(mm, units)} mm`
}

function parseFractionalNumber(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return null
  const sign = trimmed.startsWith('-') ? -1 : 1
  const unsigned = trimmed.replace(/^[+-]/, '').replace(/(\d)-(\d)/, '$1 $2').trim()
  const parts = unsigned.split(/\s+/)
  if (parts.length > 2) return null
  let whole = 0
  let fraction = parts[0]
  if (parts.length === 2) {
    whole = Number(parts[0])
    fraction = parts[1]
  }
  if (!fraction.includes('/')) {
    const decimal = Number(unsigned)
    return Number.isFinite(decimal) ? sign * decimal : null
  }
  const [numeratorText, denominatorText, ...extra] = fraction.split('/')
  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  if (extra.length || !Number.isFinite(whole) || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return sign * (whole + numerator / denominator)
}

export function parseLengthInput(input: string, units: DisplayUnits) {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null
  const explicitlyMm = /mm$/.test(trimmed)
  const explicitlyInches = /(?:in(?:ches?)?|["″])$/.test(trimmed)
  const numeric = trimmed.replace(/\s*(?:mm|in(?:ches?)?|["″])\s*$/, '').trim()
  const parsed = parseFractionalNumber(numeric)
  if (parsed === null || !Number.isFinite(parsed)) return null
  if (explicitlyMm) return parsed
  return units === 'mm' && !explicitlyInches ? parsed : parsed * MM_PER_INCH
}

export function sketchSnapIncrement(units: DisplayUnits) {
  if (units === 'in-decimal') return MM_PER_INCH / 1000
  if (units === 'in-fractional') return MM_PER_INCH / 16
  return 1
}
