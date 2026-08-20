import { describe, expect, it } from 'vitest'
import { normalizeArc } from '../core/arc-geometry'
import { createId, type SketchConstraint, type SketchConstraintType, type SketchEntity, type Vec2 } from '../core/model'
import { constraintPrimitive, pointId } from './constraint-primitives'

const HALF_PI = Math.PI / 2

function line(start: Vec2 = [0, 0], end: Vec2 = [10, 0]): SketchEntity {
  return { id: createId(), type: 'line', start, end, construction: false }
}

function circle(radius = 5): SketchEntity {
  return { id: createId(), type: 'circle', center: [0, 0], radius, construction: false }
}

function arc(radius = 5): SketchEntity {
  return { id: createId(), type: 'arc', ...normalizeArc([0, 0], radius, 0, HALF_PI), construction: false }
}

function map(...entities: SketchEntity[]) {
  return new Map(entities.map((entity) => [entity.id, entity]))
}

function constraint(
  type: SketchConstraintType,
  entities: SketchEntity[],
  extra: Partial<SketchConstraint> = {},
): SketchConstraint {
  return { id: 'c1', type, entityIds: entities.map((entity) => entity.id), ...extra }
}

describe('constraintPrimitive', () => {
  it('maps axis alignment for a line', () => {
    const l = line()
    expect(constraintPrimitive(constraint('horizontal', [l]), map(l)))
      .toEqual({ id: 'c1', type: 'horizontal_l', l_id: l.id })
    expect(constraintPrimitive(constraint('vertical', [l]), map(l)))
      .toEqual({ id: 'c1', type: 'vertical_l', l_id: l.id })
  })

  it('refuses axis alignment on a circle, which has no direction', () => {
    const c = circle()
    expect(constraintPrimitive(constraint('horizontal', [c]), map(c))).toBeNull()
  })

  // The bug this guards against: PlaneGCS has separate radius constraints for
  // circles and arcs, and applying the wrong one does not hold the radius.
  it('sends a circle radius to circle_radius and an arc radius to arc_radius', () => {
    const c = circle(7)
    const a = arc(3)
    expect(constraintPrimitive(constraint('radius', [c], { value: 7 }), map(c)))
      .toEqual({ id: 'c1', type: 'circle_radius', c_id: c.id, radius: 7 })
    expect(constraintPrimitive(constraint('radius', [a], { value: 3 }), map(a)))
      .toEqual({ id: 'c1', type: 'arc_radius', a_id: a.id, radius: 3 })
  })

  it('refuses a dimension with no value', () => {
    const c = circle()
    const l = line()
    expect(constraintPrimitive(constraint('radius', [c]), map(c))).toBeNull()
    expect(constraintPrimitive(constraint('distance', [l]), map(l))).toBeNull()
    expect(constraintPrimitive(constraint('angle', [l]), map(l))).toBeNull()
  })

  it('measures distance and angle between a line\'s own ends', () => {
    const l = line()
    expect(constraintPrimitive(constraint('distance', [l], { value: 25 }), map(l))).toEqual({
      id: 'c1',
      type: 'p2p_distance',
      p1_id: pointId(l.id, 'start'),
      p2_id: pointId(l.id, 'end'),
      distance: 25,
    })
  })

  it('joins the named points for a coincident constraint', () => {
    const a = line()
    const b = line([10, 0], [10, 9])
    const primitive = constraintPrimitive(
      constraint('coincident', [a, b], { pointRefs: ['end', 'start'] }),
      map(a, b),
    )
    expect(primitive).toEqual({
      id: 'c1',
      type: 'p2p_coincident',
      p1_id: pointId(a.id, 'end'),
      p2_id: pointId(b.id, 'start'),
    })
  })

  it('refuses a coincident constraint that does not say which points', () => {
    const a = line()
    const b = line()
    expect(constraintPrimitive(constraint('coincident', [a, b]), map(a, b))).toBeNull()
  })

  it('holds a named endpoint on an existing line', () => {
    const drawn = line([5, 0], [5, 5])
    const target = line([0, 0], [10, 0])
    expect(constraintPrimitive(
      constraint('pointOnLine', [drawn, target], { pointRefs: ['start'] }),
      map(drawn, target),
    )).toEqual({
      id: 'c1',
      type: 'point_on_line_pl',
      p_id: pointId(drawn.id, 'start'),
      l_id: target.id,
    })
  })

  it('holds a named endpoint at the midpoint of an existing line', () => {
    const drawn = line([5, 0], [5, 5])
    const target = line([0, 0], [10, 0])
    expect(constraintPrimitive(
      constraint('midpoint', [drawn, target], { pointRefs: ['start'] }),
      map(drawn, target),
    )).toEqual({
      id: 'c1',
      type: 'p2p_symmetric_ppp',
      p1_id: pointId(target.id, 'start'),
      p2_id: pointId(target.id, 'end'),
      p_id: pointId(drawn.id, 'start'),
    })
  })

  it('dimensions an endpoint from a named end of another line', () => {
    const drawn = line([67, 0], [67, 5])
    const target = line([0, 0], [100, 0])
    expect(constraintPrimitive(
      constraint('pointDistance', [drawn, target], { pointRefs: ['start', 'start'], value: 67 }),
      map(drawn, target),
    )).toEqual({
      id: 'c1',
      type: 'p2p_distance',
      p1_id: pointId(target.id, 'start'),
      p2_id: pointId(drawn.id, 'start'),
      distance: 67,
    })
  })

  it('expresses concentric as the two centres held together', () => {
    const a = circle()
    const b = arc()
    expect(constraintPrimitive(constraint('concentric', [a, b]), map(a, b))).toEqual({
      id: 'c1',
      type: 'p2p_coincident',
      p1_id: pointId(a.id, 'center'),
      p2_id: pointId(b.id, 'center'),
    })
  })

  it('picks the tangency variant that matches the pair of kinds', () => {
    const l = line()
    const c = circle()
    const a = arc()
    const a2 = arc()
    const c2 = circle()

    expect(constraintPrimitive(constraint('tangent', [l, c], {}), map(l, c)))
      .toMatchObject({ type: 'tangent_lc', l_id: l.id, c_id: c.id })
    expect(constraintPrimitive(constraint('tangent', [l, a], {}), map(l, a)))
      .toMatchObject({ type: 'tangent_la', l_id: l.id, a_id: a.id })
    expect(constraintPrimitive(constraint('tangent', [c, c2], {}), map(c, c2)))
      .toMatchObject({ type: 'tangent_cc' })
    expect(constraintPrimitive(constraint('tangent', [a, a2], {}), map(a, a2)))
      .toMatchObject({ type: 'tangent_aa' })
  })

  it('finds the line whichever way round the pair is given', () => {
    const l = line()
    const c = circle()
    expect(constraintPrimitive(constraint('tangent', [c, l], {}), map(c, l)))
      .toMatchObject({ type: 'tangent_lc', l_id: l.id, c_id: c.id })
  })

  it('refuses tangency between two lines and between a circle and an arc', () => {
    const l1 = line()
    const l2 = line()
    const c = circle()
    const a = arc()
    expect(constraintPrimitive(constraint('tangent', [l1, l2], {}), map(l1, l2))).toBeNull()
    expect(constraintPrimitive(constraint('tangent', [c, a], {}), map(c, a))).toBeNull()
  })

  it('picks the equality variant that matches the pair of kinds', () => {
    const l1 = line()
    const l2 = line()
    const c = circle()
    const c2 = circle()
    const a = arc()
    const a2 = arc()

    expect(constraintPrimitive(constraint('equal', [l1, l2], {}), map(l1, l2)))
      .toMatchObject({ type: 'equal_length' })
    expect(constraintPrimitive(constraint('equal', [c, c2], {}), map(c, c2)))
      .toMatchObject({ type: 'equal_radius_cc' })
    expect(constraintPrimitive(constraint('equal', [a, a2], {}), map(a, a2)))
      .toMatchObject({ type: 'equal_radius_aa' })
    // PlaneGCS wants the circle first regardless of selection order.
    expect(constraintPrimitive(constraint('equal', [a, c], {}), map(a, c)))
      .toMatchObject({ type: 'equal_radius_ca', c1_id: c.id, a2_id: a.id })
  })

  it('refuses equality between a line and a circle', () => {
    const l = line()
    const c = circle()
    expect(constraintPrimitive(constraint('equal', [l, c], {}), map(l, c))).toBeNull()
  })

  it('refuses parallel and perpendicular unless both are lines', () => {
    const l = line()
    const c = circle()
    expect(constraintPrimitive(constraint('parallel', [l, c], {}), map(l, c))).toBeNull()
    expect(constraintPrimitive(constraint('perpendicular', [l, c], {}), map(l, c))).toBeNull()
  })

  it('refuses any constraint naming geometry that is gone', () => {
    const l = line()
    const orphan: SketchConstraint = { id: 'c1', type: 'parallel', entityIds: [l.id, 'gone'] }
    expect(constraintPrimitive(orphan, map(l))).toBeNull()
  })

  it('carries the constraint id through, so the solver can report on it', () => {
    const l = line()
    const primitive = constraintPrimitive({ id: 'named', type: 'horizontal', entityIds: [l.id] }, map(l))
    expect(primitive?.id).toBe('named')
  })
})
