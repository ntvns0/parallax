import { describe, expect, it } from 'vitest'
import { ambientOcclusionRadius } from './ao-fit'

describe('ambientOcclusionRadius', () => {
  it('scales with the part, so shading describes form rather than size', () => {
    // The same shape at ten times the size should darken the same proportion
    // of itself, which means the radius has to scale with it.
    expect(ambientOcclusionRadius(100) / ambientOcclusionRadius(10)).toBeCloseTo(10, 6)
  })

  it('keeps a small part from going solid black', () => {
    // A 1 mm insert with a radius picked for a 200 mm bracket occludes itself
    // completely. The floor is what stops that.
    expect(ambientOcclusionRadius(0.2)).toBeGreaterThan(0)
    expect(ambientOcclusionRadius(0.2)).toBeLessThan(0.2)
  })

  it('keeps a very large part from smearing', () => {
    expect(ambientOcclusionRadius(100_000)).toBeLessThanOrEqual(40)
  })

  it('survives a model with no measurable size', () => {
    // An empty document reports a zero or non-finite radius; the pass still has
    // to be given a usable number.
    for (const radius of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ambientOcclusionRadius(radius)).toBeGreaterThan(0)
      expect(Number.isFinite(ambientOcclusionRadius(radius))).toBe(true)
    }
  })
})
