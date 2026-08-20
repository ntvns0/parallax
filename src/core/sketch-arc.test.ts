import { describe, expect, it } from 'vitest'
import { normalizeArc } from './arc-geometry'
import { createFeature, createId, type ArcEntity, type SketchFeature, type Vec2 } from './model'
import { getClosedProfiles, getProfileRegions, profileOutline, sketchBounds, type PathSegment } from './sketch'

const HALF_PI = Math.PI / 2

function sketch(): SketchFeature {
  return createFeature('sketch', 1) as SketchFeature
}

function line(start: Vec2, end: Vec2) {
  return { id: createId(), type: 'line' as const, start, end, construction: false }
}

function arc(center: Vec2, radius: number, startAngle: number, endAngle: number): ArcEntity {
  const normalized = normalizeArc(center, radius, startAngle, endAngle)
  return {
    id: createId(),
    type: 'arc',
    center: normalized.center,
    radius: normalized.radius,
    startAngle: normalized.startAngle,
    endAngle: normalized.endAngle,
    construction: false,
  }
}

/**
 * A slot: two parallel sides closed by a half-round at each end. The profile a
 * lines-and-circles sketcher cannot express, and the reason arcs exist.
 */
function slot(): SketchFeature {
  const feature = sketch()
  feature.entities = [
    line([0, 5], [20, 5]),
    // Each cap bulges away from the slot: the right one out through [25, 0],
    // the left one out through [-5, 0].
    arc([20, 0], 5, -HALF_PI, HALF_PI),
    line([20, -5], [0, -5]),
    arc([0, 0], 5, HALF_PI, -HALF_PI),
  ]
  return feature
}

describe('closed profiles containing arcs', () => {
  it('closes a slot into a single region', () => {
    const regions = getProfileRegions(slot())
    expect(regions).toHaveLength(1)
    expect(regions[0].outer.type).toBe('path')
    expect(regions[0].holes).toHaveLength(0)
  })

  it('records each edge of the slot in the order it is travelled', () => {
    const [profile] = getClosedProfiles(slot())
    expect(profile.type).toBe('path')
    if (profile.type !== 'path') return

    expect(profile.segments.map((segment) => segment.kind)).toEqual(['line', 'arc', 'line', 'arc'])
    // Each segment has to begin where the previous one ended, or the kernel
    // gets a boundary with gaps in it.
    for (let index = 0; index < profile.segments.length; index += 1) {
      const previous = profile.segments[(index + profile.segments.length - 1) % profile.segments.length]
      expect(profile.segments[index].start[0]).toBeCloseTo(previous.end[0], 9)
      expect(profile.segments[index].start[1]).toBeCloseTo(previous.end[1], 9)
    }
  })

  // A line closed by an arc: two segments, which the old three-corner minimum
  // would have thrown away as not enclosing anything.
  it('closes a two-segment D shape', () => {
    const feature = sketch()
    feature.entities = [line([0, -5], [0, 5]), arc([0, 0], 5, HALF_PI, -HALF_PI)]

    const regions = getProfileRegions(feature)
    expect(regions).toHaveLength(1)
    expect(regions[0].outer.type).toBe('path')
  })

  it('closes a two-arc lens', () => {
    // Two radius-4 circles centred at ±2 meet at [0, ±2√3], which is 60° off
    // the axis at each centre. Each arc takes the far side of its own circle.
    const feature = sketch()
    feature.entities = [
      arc([2, 0], 4, (Math.PI * 2) / 3, (-Math.PI * 2) / 3),
      arc([-2, 0], 4, -Math.PI / 3, Math.PI / 3),
    ]

    const regions = getProfileRegions(feature)
    expect(regions).toHaveLength(1)
    expect(regions[0].outer.type).toBe('path')
  })

  it('still rejects two straight edges, which enclose nothing', () => {
    const feature = sketch()
    feature.entities = [line([0, 0], [10, 0]), line([10, 0], [0, 0])]
    expect(getClosedProfiles(feature)).toHaveLength(0)
  })

  it('leaves an open chain of arcs unclosed', () => {
    const feature = sketch()
    feature.entities = [line([0, 5], [20, 5]), arc([20, 0], 5, HALF_PI, -HALF_PI)]
    expect(getClosedProfiles(feature)).toHaveLength(0)
  })

  it('ignores construction arcs', () => {
    const feature = slot()
    feature.entities[1] = { ...(feature.entities[1] as ArcEntity), construction: true }
    expect(getClosedProfiles(feature)).toHaveLength(0)
  })

  // The compatibility promise: an all-line sketch must serialize exactly as it
  // did before paths existed, or every cached exact solid is invalidated.
  it('still emits a polygon for a boundary of straight edges only', () => {
    const feature = sketch()
    feature.entities = [
      line([0, 0], [10, 0]),
      line([10, 0], [10, 10]),
      line([10, 10], [0, 10]),
      line([0, 10], [0, 0]),
    ]
    const [profile] = getClosedProfiles(feature)
    expect(profile.type).toBe('polygon')
  })

  it('treats a round-ended slot as a hole when it sits inside a plate', () => {
    const feature = slot()
    feature.entities.unshift(
      line([-20, -20], [40, -20]),
      line([40, -20], [40, 20]),
      line([40, 20], [-20, 20]),
      line([-20, 20], [-20, -20]),
    )

    const regions = getProfileRegions(feature)
    expect(regions).toHaveLength(1)
    expect(regions[0].outer.type).toBe('polygon')
    expect(regions[0].holes).toHaveLength(1)
    expect(regions[0].holes[0].type).toBe('path')
  })
})

describe('profileOutline', () => {
  it('walks a path in travel order, including reversed arcs', () => {
    const [profile] = getClosedProfiles(slot())
    if (profile.type !== 'path') throw new Error('expected a path profile')
    const outline = profileOutline(profile, 8)

    // Every point of a slot lies within its overall envelope, and consecutive
    // points stay close together: a reversed arc emitted backwards would show
    // up as a long jump between neighbours.
    for (const point of outline) {
      expect(point[0]).toBeGreaterThanOrEqual(-5.001)
      expect(point[0]).toBeLessThanOrEqual(25.001)
      expect(Math.abs(point[1])).toBeLessThanOrEqual(5.001)
    }
    for (let index = 1; index < outline.length; index += 1) {
      const step = Math.hypot(outline[index][0] - outline[index - 1][0], outline[index][1] - outline[index - 1][1])
      expect(step).toBeLessThan(21)
    }
  })
})

describe('sketchBounds with arcs', () => {
  it('bounds an arc by its own extent rather than its parent circle', () => {
    const bounds = sketchBounds([arc([0, 0], 10, 0, HALF_PI)])
    expect(bounds.min[0]).toBeCloseTo(0, 9)
    expect(bounds.min[1]).toBeCloseTo(0, 9)
    expect(bounds.width).toBeCloseTo(10, 9)
    expect(bounds.height).toBeCloseTo(10, 9)
  })
})

describe('path segment direction', () => {
  it('marks an arc travelled against its stored winding as clockwise', () => {
    const [profile] = getClosedProfiles(slot())
    if (profile.type !== 'path') throw new Error('expected a path profile')
    const arcs = profile.segments.filter((segment): segment is Extract<PathSegment, { kind: 'arc' }> =>
      segment.kind === 'arc')

    expect(arcs).toHaveLength(2)
    // The walk enters each end cap at the end of a straight side, which is the
    // arc's stored end for one cap and its stored start for the other.
    expect(arcs.some((segment) => segment.clockwise)).toBe(true)
  })
})
