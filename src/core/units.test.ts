import { describe, expect, it } from 'vitest'
import { formatLengthInput, parseLengthInput, sketchSnapIncrement } from './units'

describe('display units', () => {
  it('formats machinist inches to thousandths without changing internal millimeters', () => {
    expect(formatLengthInput(31.75, 'in-decimal')).toBe('1.250')
    expect(parseLengthInput('1.250', 'in-decimal')).toBeCloseTo(31.75)
  })

  it('formats and parses carpenter fractions to sixteenths', () => {
    expect(formatLengthInput(33.3375, 'in-fractional')).toBe('1 5/16')
    expect(parseLengthInput('1 5/16', 'in-fractional')).toBeCloseTo(33.3375)
    expect(parseLengthInput('7/16\u2033', 'in-fractional')).toBeCloseTo(11.1125)
    expect(sketchSnapIncrement('in-fractional')).toBeCloseTo(1.5875)
  })

  it('accepts explicit cross-unit suffixes', () => {
    expect(parseLengthInput('25.4 mm', 'in-decimal')).toBeCloseTo(25.4)
    expect(parseLengthInput('1 in', 'mm')).toBeCloseTo(25.4)
  })
})
