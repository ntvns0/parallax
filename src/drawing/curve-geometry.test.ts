import { describe, expect, it } from 'vitest'
import {
  TAU,
  angularCoverage,
  arcThroughPoints,
  circleThroughPoints,
  curveBounds,
  dedupeCurves,
  distanceToCurve,
  mergeArcsIntoCircles,
  suppressCoveredCurves,
} from './curve-geometry'
import type { ProjectedCurve } from './drawing-types'

/** The two half-arcs hidden-line removal produces for one circular edge. */
function halvesOf(center: [number, number], radius: number): ProjectedCurve[] {
  return [
    { type: 'arc', center, radius, startAngle: 0, endAngle: Math.PI },
    { type: 'arc', center, radius, startAngle: Math.PI, endAngle: TAU },
  ]
}

describe('circleThroughPoints', () => {
  it('recovers the centre and radius of a circle from three points on it', () => {
    const circle = circleThroughPoints([6, 1], [11, 6], [6, 11])
    expect(circle).not.toBeNull()
    expect(circle!.center[0]).toBeCloseTo(6, 9)
    expect(circle!.center[1]).toBeCloseTo(6, 9)
    expect(circle!.radius).toBeCloseTo(5, 9)
  })

  it('refuses collinear points instead of inventing a huge radius', () => {
    expect(circleThroughPoints([0, 0], [5, 0], [10, 0])).toBeNull()
  })
})

describe('arcThroughPoints', () => {
  it('stores a counter-clockwise arc as given', () => {
    const arc = arcThroughPoints([1, 0], [0, 1], [-1, 0])
    expect(arc).toEqual({ type: 'arc', center: expect.anything(), radius: expect.anything(), startAngle: 0, endAngle: Math.PI })
  })

  it('reverses a clockwise arc so every stored arc sweeps the same way', () => {
    const arc = arcThroughPoints([-1, 0], [0, 1], [1, 0])
    expect(arc?.type).toBe('arc')
    const stored = arc as Extract<ProjectedCurve, { type: 'arc' }>
    expect(stored.startAngle).toBeCloseTo(0, 9)
    expect(stored.endAngle).toBeCloseTo(Math.PI, 9)
  })

  it('keeps the long way round when the midpoint says so', () => {
    // From 0° to 90°, but passing through 180°: a three-quarter turn.
    const arc = arcThroughPoints([1, 0], [-1, 0], [0, 1]) as Extract<ProjectedCurve, { type: 'arc' }>
    expect(arc.endAngle - arc.startAngle).toBeCloseTo((3 * Math.PI) / 2, 6)
  })
})

describe('angularCoverage', () => {
  it('counts overlapping arcs once', () => {
    const overlapping = [
      { type: 'arc', center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI },
      { type: 'arc', center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI },
    ] as Extract<ProjectedCurve, { type: 'arc' }>[]
    expect(angularCoverage(overlapping)).toBeCloseTo(Math.PI, 9)
  })

  it('handles an arc that crosses the zero angle', () => {
    const wrapping = [
      { type: 'arc', center: [0, 0], radius: 1, startAngle: (3 * Math.PI) / 2, endAngle: (3 * Math.PI) / 2 + Math.PI },
    ] as Extract<ProjectedCurve, { type: 'arc' }>[]
    expect(angularCoverage(wrapping)).toBeCloseTo(Math.PI, 9)
  })
})

describe('mergeArcsIntoCircles', () => {
  it('rejoins the two half-arcs a projected hole arrives as', () => {
    const merged = mergeArcsIntoCircles(halvesOf([6, 5], 4))
    expect(merged).toEqual([{ type: 'circle', center: [6, 5], radius: 4 }])
  })

  it('leaves a genuine part-circle alone', () => {
    const arcs: ProjectedCurve[] = [{ type: 'arc', center: [0, 0], radius: 3, startAngle: 0, endAngle: Math.PI / 2 }]
    expect(mergeArcsIntoCircles(arcs)).toEqual(arcs)
  })

  it('does not merge arcs belonging to different circles', () => {
    const merged = mergeArcsIntoCircles([...halvesOf([0, 0], 2), ...halvesOf([20, 0], 2)])
    expect(merged.filter((curve) => curve.type === 'circle')).toHaveLength(2)
  })
})

describe('distanceToCurve', () => {
  it('measures to the nearest end when a point is past an arc', () => {
    const arc: ProjectedCurve = { type: 'arc', center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI / 2 }
    // Straight down from the centre: outside the sweep, so the 0° end is nearest.
    expect(distanceToCurve([0, -1], arc)).toBeCloseTo(Math.SQRT2, 6)
  })

  it('measures radially when the point is within the sweep', () => {
    const arc: ProjectedCurve = { type: 'arc', center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI / 2 }
    expect(distanceToCurve([0, 3], arc)).toBeCloseTo(2, 6)
  })
})

describe('suppressCoveredCurves', () => {
  it('drops the back-face outline that projects onto the visible outline', () => {
    const visible: ProjectedCurve[] = [{ type: 'segment', start: [0, 0], end: [30, 0] }]
    const hidden: ProjectedCurve[] = [{ type: 'segment', start: [30, 0], end: [0, 0] }]
    expect(suppressCoveredCurves(hidden, visible)).toEqual([])
  })

  it('keeps an internal hidden edge that nothing visible covers', () => {
    const visible: ProjectedCurve[] = [{ type: 'segment', start: [0, 0], end: [30, 0] }]
    const hidden: ProjectedCurve[] = [{ type: 'segment', start: [2, 0], end: [2, 10] }]
    expect(suppressCoveredCurves(hidden, visible)).toHaveLength(1)
  })

  it('keeps a partially covered hidden edge rather than deleting internal geometry', () => {
    const visible: ProjectedCurve[] = [{ type: 'segment', start: [0, 0], end: [10, 0] }]
    const hidden: ProjectedCurve[] = [{ type: 'segment', start: [0, 0], end: [30, 0] }]
    expect(suppressCoveredCurves(hidden, visible)).toHaveLength(1)
  })
})

describe('dedupeCurves', () => {
  it('removes the duplicate each shared edge is reported as', () => {
    const curves: ProjectedCurve[] = [
      { type: 'segment', start: [0, 0], end: [10, 0] },
      { type: 'segment', start: [0, 0], end: [10, 0] },
      { type: 'segment', start: [0, 0], end: [0, 10] },
    ]
    expect(dedupeCurves(curves)).toHaveLength(2)
  })
})

describe('curveBounds', () => {
  it('includes the axis crossing inside an arc sweep, not just its ends', () => {
    // A quarter arc from 0° to 90° reaches (0, 1) and (1, 0) at its ends, and
    // nothing further out — but its top must still be y = 1, not the chord.
    const bounds = curveBounds({ type: 'arc', center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI / 2 })
    expect(bounds!.max[0]).toBeCloseTo(1, 9)
    expect(bounds!.max[1]).toBeCloseTo(1, 9)
    expect(bounds!.min[0]).toBeCloseTo(0, 9)
  })

  it('bounds a half arc by its bulge rather than its endpoints', () => {
    const bounds = curveBounds({ type: 'arc', center: [0, 0], radius: 2, startAngle: 0, endAngle: Math.PI })
    expect(bounds!.max[1]).toBeCloseTo(2, 9)
    expect(bounds!.min[1]).toBeCloseTo(0, 9)
  })

  it('bounds a full circle by its radius', () => {
    const bounds = curveBounds({ type: 'circle', center: [5, 5], radius: 3 })
    expect(bounds).toEqual({ min: [2, 2], max: [8, 8] })
  })
})
