import { describe, expect, it } from 'vitest'
import {
  TAU,
  angleWithinArc,
  arcBounds,
  arcEndPoint,
  arcFromCenterAndPoints,
  arcFromThreePoints,
  arcMidPoint,
  arcPointAt,
  arcStartPoint,
  distanceToArc,
  locateOnArc,
  normalizeArc,
  sampleArc,
  tangentArcFromEndpoint,
} from './arc-geometry'
import type { Vec2 } from './model'

const HALF_PI = Math.PI / 2

function expectPoint(actual: Vec2, expected: Vec2, precision = 9) {
  expect(actual[0]).toBeCloseTo(expected[0], precision)
  expect(actual[1]).toBeCloseTo(expected[1], precision)
}

/** The upper-right quarter of a unit circle at the origin. */
const quarter = normalizeArc([0, 0], 1, 0, HALF_PI)

describe('arcFromThreePoints', () => {
  it('creates the arc on the side of the chord chosen by the third point', () => {
    const upper = arcFromThreePoints([-5, 0], [5, 0], [0, 5])!
    expectPoint(upper.center, [0, 0])
    expect(upper.radius).toBeCloseTo(5, 9)
    expectPoint(arcStartPoint(upper), [5, 0])
    expectPoint(arcEndPoint(upper), [-5, 0])
    expectPoint(arcMidPoint(upper), [0, 5])

    const lower = arcFromThreePoints([-5, 0], [5, 0], [0, -5])!
    expectPoint(arcMidPoint(lower), [0, -5])
  })

  it('rejects collinear and repeated points', () => {
    expect(arcFromThreePoints([0, 0], [5, 0], [10, 0])).toBeNull()
    expect(arcFromThreePoints([0, 0], [0, 0], [0, 5])).toBeNull()
  })

  it('passes through an off-axis curvature point', () => {
    const through: Vec2 = [3, 4]
    const arc = arcFromThreePoints([0, 0], [8, 0], through)!
    expect(distanceToArc(arc, through)).toBeCloseTo(0, 9)
  })
})

describe('tangentArcFromEndpoint', () => {
  it('builds a circular arc leaving the join in the requested direction', () => {
    const arc = tangentArcFromEndpoint([10, 0], [15, 5], [1, 0])!
    expectPoint(arc.center, [10, 5])
    expect(arc.radius).toBeCloseTo(5, 9)
    expect(arc.joinRef).toBe('start')
    expectPoint(arcStartPoint(arc), [10, 0])
    expectPoint(arcEndPoint(arc), [15, 5])
  })

  it('reverses storage when the tangent path is clockwise', () => {
    const arc = tangentArcFromEndpoint([0, 0], [-5, 5], [-1, 0])!
    expectPoint(arc.center, [0, 5])
    expect(arc.joinRef).toBe('end')
    expectPoint(arcEndPoint(arc), [0, 0])
  })

  it('rejects a straight continuation with infinite radius', () => {
    expect(tangentArcFromEndpoint([0, 0], [5, 0], [1, 0])).toBeNull()
  })
})

describe('normalizeArc', () => {
  it('keeps a counter-clockwise sweep as it is', () => {
    expect(quarter.startAngle).toBeCloseTo(0, 9)
    expect(quarter.endAngle).toBeCloseTo(HALF_PI, 9)
  })

  it('rewrites a clockwise sweep as the same arc read the other way', () => {
    const arc = normalizeArc([0, 0], 1, HALF_PI, 0)
    expect(arc.endAngle).toBeGreaterThan(arc.startAngle)
    // Sweeping clockwise from 90° to 0° covers the other three quadrants.
    expect(arc.endAngle - arc.startAngle).toBeCloseTo(TAU - HALF_PI, 9)
  })

  it('treats coincident angles as a full turn rather than a point', () => {
    const arc = normalizeArc([0, 0], 1, 1, 1)
    expect(arc.endAngle - arc.startAngle).toBeCloseTo(TAU, 9)
  })

  it('normalizes angles given outside a single turn', () => {
    const arc = normalizeArc([0, 0], 1, TAU + HALF_PI, TAU + Math.PI)
    expect(arc.startAngle).toBeCloseTo(HALF_PI, 9)
    expect(arc.endAngle - arc.startAngle).toBeCloseTo(HALF_PI, 9)
  })
})

describe('arcFromCenterAndPoints', () => {
  it('takes its radius from the start point, not the end click', () => {
    // The end point is well off the circle; it should set direction only.
    const arc = arcFromCenterAndPoints([0, 0], [2, 0], [0, 37])!
    expect(arc.radius).toBeCloseTo(2, 9)
    expectPoint(arcEndPoint(arc), [0, 2])
  })

  it('rejects a degenerate arc whose start is its centre', () => {
    expect(arcFromCenterAndPoints([0, 0], [0, 0], [1, 1])).toBeNull()
  })

  it('does not turn coincident start and end directions into a circle', () => {
    expect(arcFromCenterAndPoints([0, 0], [5, 0], [12, 0])).toBeNull()
  })
})

describe('arc points', () => {
  it('places the endpoints at the swept angles', () => {
    expectPoint(arcStartPoint(quarter), [1, 0])
    expectPoint(arcEndPoint(quarter), [0, 1])
  })

  it('puts the midpoint on the arc, not on its chord', () => {
    const mid = arcMidPoint(quarter)
    const chordMid: Vec2 = [0.5, 0.5]
    expectPoint(mid, [Math.SQRT1_2, Math.SQRT1_2])
    // The distinction that makes fillet edge matching work at all.
    expect(Math.hypot(mid[0], mid[1])).toBeCloseTo(1, 9)
    expect(Math.hypot(chordMid[0], chordMid[1])).toBeLessThan(1)
  })

  it('runs the parameter from the start of the sweep to its end', () => {
    expectPoint(arcPointAt(quarter, 0), [1, 0])
    expectPoint(arcPointAt(quarter, 1), [0, 1])
  })
})

describe('locateOnArc', () => {
  it('reports a point on the curve as being on it', () => {
    const located = locateOnArc(quarter, [Math.SQRT1_2, Math.SQRT1_2])
    expect(located.distance).toBeCloseTo(0, 9)
    expect(located.t).toBeCloseTo(0.5, 9)
  })

  it('measures a point off the curve radially', () => {
    expect(locateOnArc(quarter, [1.25, 0]).distance).toBeCloseTo(0.25, 9)
  })

  // The failure this guards against: a point on the three quadrants the arc
  // does *not* cover sits on the parent circle, and a naive radial test would
  // call it a perfect match.
  it('does not claim a point on the arc\'s missing remainder', () => {
    // Dead on the parent circle, and a radial-only test would score it 0.
    const behind: Vec2 = [-1, 0]
    expect(Math.hypot(behind[0], behind[1])).toBeCloseTo(quarter.radius, 9)
    // Measured to the nearer end of the arc instead: [0, 1], at √2.
    expect(distanceToArc(quarter, behind)).toBeCloseTo(Math.SQRT2, 9)
    expect(locateOnArc(quarter, behind).t).toBe(1)
  })

  it('clamps to the nearer end when a point is past the sweep', () => {
    expect(locateOnArc(quarter, [0.1, -3]).t).toBe(0)
    expect(locateOnArc(quarter, [-3, 0.1]).t).toBe(1)
  })
})

describe('arcBounds', () => {
  it('bounds a quarter arc by its own extent, not its parent circle', () => {
    const bounds = arcBounds(quarter)
    expectPoint(bounds.min, [0, 0])
    expectPoint(bounds.max, [1, 1])
  })

  it('includes an axis crossing that falls inside the sweep', () => {
    // From -45° to +45°, which crosses the positive X axis at its widest.
    const arc = normalizeArc([0, 0], 1, -Math.PI / 4, Math.PI / 4)
    expect(arcBounds(arc).max[0]).toBeCloseTo(1, 9)
    expect(arcBounds(arc).min[0]).toBeCloseTo(Math.SQRT1_2, 9)
  })

  it('bounds a full turn as the whole circle', () => {
    const bounds = arcBounds(normalizeArc([3, 4], 2, 0, 0))
    expectPoint(bounds.min, [1, 2])
    expectPoint(bounds.max, [5, 6])
  })
})

describe('angleWithinArc and sampleArc', () => {
  it('accepts an angle inside the sweep and rejects one outside', () => {
    expect(angleWithinArc(quarter, Math.PI / 4)).toBe(true)
    expect(angleWithinArc(quarter, Math.PI)).toBe(false)
  })

  it('samples from one end to the other, inclusive', () => {
    const points = sampleArc(quarter, 4)
    expect(points).toHaveLength(5)
    expectPoint(points[0], [1, 0])
    expectPoint(points[4], [0, 1])
    for (const point of points) expect(Math.hypot(point[0], point[1])).toBeCloseTo(1, 9)
  })
})
