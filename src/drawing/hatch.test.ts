import { describe, expect, it } from 'vitest'
import type { Point2, SectionRegion } from './drawing-types'
import { hatchRegions } from './hatch'

/** An axis-aligned rectangle, wound counter-clockwise. */
function rectangle(x: number, y: number, width: number, height: number): Point2[] {
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
}

const segmentLength = ([from, to]: [Point2, Point2]) => Math.hypot(to[0] - from[0], to[1] - from[1])

describe('hatchRegions', () => {
  it('fills a plain rectangle', () => {
    const region: SectionRegion = { outer: rectangle(0, 0, 20, 10), holes: [] }
    const segments = hatchRegions([region], 2)
    expect(segments.length).toBeGreaterThan(5)
    for (const segment of segments) expect(segmentLength(segment)).toBeGreaterThan(0)
  })

  it('keeps every hatch line inside the material', () => {
    const region: SectionRegion = { outer: rectangle(0, 0, 20, 10), holes: [] }
    for (const [from, to] of hatchRegions([region], 1.5)) {
      for (const [x, y] of [from, to]) {
        expect(x).toBeGreaterThanOrEqual(-1e-9)
        expect(x).toBeLessThanOrEqual(20 + 1e-9)
        expect(y).toBeGreaterThanOrEqual(-1e-9)
        expect(y).toBeLessThanOrEqual(10 + 1e-9)
      }
    }
  })

  it('leaves a hole unhatched', () => {
    // A bore through the middle must read as somewhere you can see through, not
    // as material. Every scan line crossing it has to break in two.
    const withHole: SectionRegion = { outer: rectangle(0, 0, 30, 30), holes: [rectangle(10, 10, 10, 10)] }
    const solid: SectionRegion = { outer: rectangle(0, 0, 30, 30), holes: [] }

    const inHole = ([from, to]: [Point2, Point2]) => {
      const midpoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
      return midpoint[0] > 10 && midpoint[0] < 20 && midpoint[1] > 10 && midpoint[1] < 20
    }

    const hatched = hatchRegions([withHole], 2)
    expect(hatched.some(inHole)).toBe(false)
    // The hole splits lines rather than removing them, so there are more pieces.
    expect(hatched.length).toBeGreaterThan(hatchRegions([solid], 2).length)
  })

  it('covers less area once a hole is cut out of the same outline', () => {
    const total = (regions: SectionRegion[]) =>
      hatchRegions(regions, 1).reduce((sum, segment) => sum + segmentLength(segment), 0)
    const solid = total([{ outer: rectangle(0, 0, 30, 30), holes: [] }])
    const bored = total([{ outer: rectangle(0, 0, 30, 30), holes: [rectangle(10, 10, 10, 10)] }])
    expect(bored).toBeLessThan(solid)
    expect(bored).toBeGreaterThan(solid * 0.5)
  })

  it('does not bridge two separate pieces of material', () => {
    // Two ribs with a gap between them: nothing may be drawn in the gap.
    const left: SectionRegion = { outer: rectangle(0, 0, 10, 10), holes: [] }
    const right: SectionRegion = { outer: rectangle(20, 0, 10, 10), holes: [] }
    for (const [from, to] of hatchRegions([left, right], 1.5)) {
      const midpointX = (from[0] + to[0]) / 2
      expect(midpointX > 10 && midpointX < 20).toBe(false)
    }
  })

  it('puts both pieces on the same scan lines, so one cut reads as one part', () => {
    const left: SectionRegion = { outer: rectangle(0, 0, 10, 10), holes: [] }
    const right: SectionRegion = { outer: rectangle(20, 0, 10, 10), holes: [] }
    const offsets = new Set(
      hatchRegions([left, right], 2).map(([from]) => Math.round((-from[0] * Math.SQRT1_2 + from[1] * Math.SQRT1_2) * 1000)),
    )
    const separate = new Set([
      ...hatchRegions([left], 2).map(([from]) => Math.round((-from[0] * Math.SQRT1_2 + from[1] * Math.SQRT1_2) * 1000)),
    ])
    for (const offset of separate) expect(offsets.has(offset)).toBe(true)
  })

  it('spaces lines as asked', () => {
    const region: SectionRegion = { outer: rectangle(0, 0, 40, 40), holes: [] }
    expect(hatchRegions([region], 2).length).toBeGreaterThan(hatchRegions([region], 5).length)
  })

  it('returns nothing for a degenerate region or a non-positive spacing', () => {
    expect(hatchRegions([{ outer: [[0, 0], [1, 1]], holes: [] }], 2)).toEqual([])
    expect(hatchRegions([{ outer: rectangle(0, 0, 10, 10), holes: [] }], 0)).toEqual([])
    expect(hatchRegions([], 2)).toEqual([])
  })
})
