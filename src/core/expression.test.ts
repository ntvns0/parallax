import { describe, expect, it } from 'vitest'
import {
  ExpressionError,
  evaluateExpression,
  expressionDependencies,
  isValidParameterName,
  parseExpression,
  readDependencies,
  tryEvaluateExpression,
} from './expression'

const evaluate = (source: string, scope: Record<string, number> = {}) => evaluateExpression(parseExpression(source), scope)

describe('parseExpression', () => {
  it('applies the conventional operator precedence', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14)
    expect(evaluate('(2 + 3) * 4')).toBe(20)
    expect(evaluate('10 - 2 - 3')).toBe(5)
    expect(evaluate('12 / 2 / 3')).toBe(2)
  })

  it('treats exponentiation as right-associative, as mathematical notation does', () => {
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512)
  })

  it('binds unary minus more loosely than exponentiation', () => {
    expect(evaluate('-2 ^ 2')).toBe(-4)
    expect(evaluate('(-2) ^ 2')).toBe(4)
  })

  it('reads a unary sign in front of a parameter and keeps the rest of the product', () => {
    expect(evaluate('-a * b', { a: 3, b: 4 })).toBe(-12)
    expect(evaluate('+a', { a: 3 })).toBe(3)
  })

  it('rejects a formula with trailing junk rather than silently reading a prefix', () => {
    expect(() => evaluate('12 24')).toThrow(ExpressionError)
    expect(() => evaluate('12 +')).toThrow(ExpressionError)
    expect(() => evaluate('')).toThrow(ExpressionError)
    expect(() => evaluate('(3 + 4')).toThrow(ExpressionError)
  })

  it('refuses characters that are not part of the language', () => {
    // The important half of this: a formula is inert data, so nothing that
    // could be script gets through the tokenizer.
    expect(() => evaluate('globalThis.alert`x`')).toThrow(ExpressionError)
    expect(() => evaluate('a; b')).toThrow(ExpressionError)
  })
})

describe('number literals', () => {
  it('reads a bare number as millimeters, the document unit', () => {
    expect(evaluate('12.5')).toBe(12.5)
    expect(evaluate('12.5mm')).toBe(12.5)
    expect(evaluate('.5')).toBe(0.5)
    expect(evaluate('1e2')).toBe(100)
  })

  it('converts an inch literal, in each spelling', () => {
    expect(evaluate('1in')).toBeCloseTo(25.4, 9)
    expect(evaluate('1inch')).toBeCloseTo(25.4, 9)
    expect(evaluate('1inches')).toBeCloseTo(25.4, 9)
    expect(evaluate('1"')).toBeCloseTo(25.4, 9)
    expect(evaluate('1″')).toBeCloseTo(25.4, 9)
  })

  it('binds a unit suffix to its own literal rather than to the expression', () => {
    // Were the suffix read as a trailing identifier, `in` would parse as an
    // unknown parameter and this would fail instead of being 3 inches.
    expect(evaluate('1in*3')).toBeCloseTo(76.2, 9)
    expect(evaluate('1in + 1mm')).toBeCloseTo(26.4, 9)
  })
})

describe('functions and constants', () => {
  it('does trigonometry in degrees, matching every angle the document stores', () => {
    expect(evaluate('sin(30)')).toBeCloseTo(0.5, 12)
    expect(evaluate('cos(60)')).toBeCloseTo(0.5, 12)
    expect(evaluate('atan2(1, 1)')).toBeCloseTo(45, 12)
    expect(evaluate('asin(0.5)')).toBeCloseTo(30, 12)
  })

  it('converts between degrees and radians explicitly', () => {
    expect(evaluate('rad(180)')).toBeCloseTo(Math.PI, 12)
    expect(evaluate('deg(pi)')).toBeCloseTo(180, 12)
  })

  it('supports the variadic and two-argument builtins', () => {
    expect(evaluate('max(1, 9, 4)')).toBe(9)
    expect(evaluate('min(1, 9, 4)')).toBe(1)
    expect(evaluate('hypot(3, 4)')).toBe(5)
    expect(evaluate('pow(2, 10)')).toBe(1024)
    expect(evaluate('round(2.5)')).toBe(3)
  })

  it('reports the wrong number of arguments against the function name', () => {
    expect(() => evaluate('sqrt(1, 2)')).toThrow(/sqrt\(\) takes 1 value/)
    expect(() => evaluate('max()')).toThrow(/at least one value/)
    expect(() => evaluate('nope(1)')).toThrow(/no function named "nope"/)
  })

  it('reports a domain error instead of letting NaN reach the model', () => {
    expect(() => evaluate('sqrt(-1)')).toThrow(/undefined/)
    expect(() => evaluate('log(0)')).toThrow(/undefined/)
    expect(() => evaluate('1 / 0')).toThrow(/divides by zero/)
    expect(() => evaluate('1 % 0')).toThrow(/remainder by zero/)
    expect(() => evaluate('(-8) ^ 0.5')).toThrow(/not a real number/)
  })
})

describe('variables', () => {
  it('resolves parameters from the scope and names the missing one', () => {
    expect(evaluate('width / 2', { width: 50 })).toBe(25)
    expect(() => evaluate('width / 2')).toThrow(/no parameter named "width"/)
  })

  it('lets a parameter shadow nothing reserved', () => {
    expect(isValidParameterName('plate_width')).toBe(true)
    expect(isValidParameterName('_hidden')).toBe(true)
    expect(isValidParameterName('pi')).toBe(false)
    expect(isValidParameterName('PI')).toBe(false)
    expect(isValidParameterName('sin')).toBe(false)
    expect(isValidParameterName('2wide')).toBe(false)
    expect(isValidParameterName('has space')).toBe(false)
    expect(isValidParameterName('')).toBe(false)
  })
})

describe('expressionDependencies', () => {
  it('lists each referenced parameter once, in reference order', () => {
    expect(expressionDependencies(parseExpression('a + b * a - c'))).toEqual(['a', 'b', 'c'])
  })

  it('reads through calls and excludes constants', () => {
    expect(expressionDependencies(parseExpression('max(bore, pi * shaft)'))).toEqual(['bore', 'shaft'])
  })

  it('returns nothing for a formula it cannot parse', () => {
    expect(readDependencies('a +')).toEqual([])
    expect(readDependencies('a + b')).toEqual(['a', 'b'])
  })
})

describe('tryEvaluateExpression', () => {
  it('reports success and failure without throwing', () => {
    expect(tryEvaluateExpression('2 * thickness', { thickness: 3 })).toEqual({ ok: true, value: 6 })
    const failure = tryEvaluateExpression('2 * ', {})
    expect(failure.ok).toBe(false)
    expect(failure.ok === false && failure.error).toMatch(/formula/i)
  })
})
