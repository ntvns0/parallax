import { describe, expect, it } from 'vitest'
import { fogDensityForRadius } from './fog-fit'

/** The fraction of a surface lost to fog, as three.js FogExp2 computes it. */
const fade = (density: number, depth: number) => 1 - Math.exp(-((density * depth) ** 2))
const framingDistance = (radius: number) => radius * 3.62

describe('fogDensityForRadius', () => {
  it('fades a small part the same as a large one at framing distance', () => {
    const small = fade(fogDensityForRadius(60), framingDistance(60))
    const large = fade(fogDensityForRadius(300), framingDistance(300))

    expect(small).toBeCloseTo(large, 6)
  })

  it('keeps the part clearly visible when framed', () => {
    // The reported bug: at a fixed density a 500mm plate lost 92% to fog and
    // was indistinguishable from the background.
    for (const radius of [5, 60, 300, 2000]) {
      expect(fade(fogDensityForRadius(radius), framingDistance(radius))).toBeLessThan(0.2)
    }
  })

  it('still reads as depth rather than being switched off', () => {
    for (const radius of [5, 60, 300, 2000]) {
      expect(fade(fogDensityForRadius(radius), framingDistance(radius))).toBeGreaterThan(0.05)
    }
  })

  it('matches the old hand-tuned density at the size it was tuned for', () => {
    // 0.0015 looked right on parts around 60 units, which is why only large
    // models ever looked wrong.
    expect(fogDensityForRadius(60)).toBeCloseTo(0.0015, 3)
  })

  it('fades further away and less close up, so it still gives depth', () => {
    const density = fogDensityForRadius(100)

    expect(fade(density, 100)).toBeLessThan(fade(density, 400))
  })

  it('survives a degenerate radius rather than producing NaN', () => {
    for (const radius of [0, Number.NaN, -10]) {
      const density = fogDensityForRadius(radius)
      expect(Number.isFinite(density)).toBe(true)
      expect(density).toBeGreaterThan(0)
    }
  })
})
