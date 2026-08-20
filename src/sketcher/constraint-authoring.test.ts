import { describe, expect, it } from 'vitest'
import { normalizeArc } from '../core/arc-geometry'
import { createId, type SketchEntity, type Vec2 } from '../core/model'
import { availableConstraints, buildConstraint, describeConstraint } from './constraint-authoring'

const HALF_PI = Math.PI / 2

function line(start: Vec2, end: Vec2): SketchEntity {
  return { id: createId(), type: 'line', start, end, construction: false }
}

function circle(center: Vec2, radius: number): SketchEntity {
  return { id: createId(), type: 'circle', center, radius, construction: false }
}

function arc(center: Vec2, radius: number, from: number, to: number): SketchEntity {
  const normalized = normalizeArc(center, radius, from, to)
  return { id: createId(), type: 'arc', ...normalized, construction: false }
}

function typesFor(entities: SketchEntity[], ids: string[]) {
  return availableConstraints(entities, ids).map((option) => option.type).sort()
}

describe('availableConstraints', () => {
  it('offers nothing without a selection', () => {
    expect(availableConstraints([line([0, 0], [1, 0])], [])).toEqual([])
  })

  it('offers axis alignment for a single line', () => {
    const entities = [line([0, 0], [10, 3])]
    expect(typesFor(entities, [entities[0].id])).toEqual(['horizontal', 'vertical'])
  })

  it('offers nothing for a single circle, which has no direction to fix', () => {
    const entities = [circle([0, 0], 5)]
    expect(typesFor(entities, [entities[0].id])).toEqual([])
  })

  it('relates two lines by direction and length', () => {
    const entities = [line([0, 0], [10, 0]), line([0, 5], [10, 5])]
    expect(typesFor(entities, entities.map((entity) => entity.id)))
      .toEqual(['coincident', 'equal', 'parallel', 'perpendicular'])
  })

  // Two straight lines have no curvature to meet smoothly, and PlaneGCS has no
  // constraint for it, so offering tangency would be a button that silently
  // does nothing.
  it('does not offer tangency between two lines', () => {
    const entities = [line([0, 0], [10, 0]), line([0, 5], [10, 5])]
    expect(typesFor(entities, entities.map((entity) => entity.id))).not.toContain('tangent')
  })

  it('relates two circles by centre, radius and tangency', () => {
    const entities = [circle([0, 0], 5), circle([20, 0], 5)]
    expect(typesFor(entities, entities.map((entity) => entity.id)))
      .toEqual(['concentric', 'equal', 'tangent'])
  })

  it('offers tangency between a line and an arc', () => {
    const entities = [line([0, 0], [10, 0]), arc([5, 5], 5, -HALF_PI, HALF_PI)]
    expect(typesFor(entities, entities.map((entity) => entity.id))).toContain('tangent')
  })

  // PlaneGCS has tangent_cc and tangent_aa but no circle-to-arc variant.
  it('does not offer tangency between a circle and an arc', () => {
    const entities = [circle([0, 0], 5), arc([20, 0], 5, 0, HALF_PI)]
    expect(typesFor(entities, entities.map((entity) => entity.id))).not.toContain('tangent')
  })

  it('offers joining for two entities that have ends', () => {
    const entities = [line([0, 0], [10, 0]), arc([15, 0], 5, Math.PI, 0)]
    expect(typesFor(entities, entities.map((entity) => entity.id))).toContain('coincident')
  })

  it('does not offer joining a circle, which has no ends', () => {
    const entities = [line([0, 0], [10, 0]), circle([15, 0], 5)]
    expect(typesFor(entities, entities.map((entity) => entity.id))).not.toContain('coincident')
  })

  it('offers nothing for three entities', () => {
    const entities = [line([0, 0], [1, 0]), line([0, 1], [1, 1]), line([0, 2], [1, 2])]
    expect(availableConstraints(entities, entities.map((entity) => entity.id))).toEqual([])
  })

  it('ignores ids that name nothing', () => {
    const entities = [line([0, 0], [10, 0])]
    expect(availableConstraints(entities, [entities[0].id, 'ghost'])).toEqual(
      availableConstraints(entities, [entities[0].id]),
    )
  })
})

describe('buildConstraint', () => {
  it('joins the two nearest ends', () => {
    // The lines nearly touch at [10, 0] — the first line's end and the second's
    // start — so those are the pair that should be held together.
    const first = line([0, 0], [10, 0])
    const second = line([10.01, 0], [10.01, 9])
    const constraint = buildConstraint('coincident', [first, second], [first.id, second.id])

    expect(constraint).not.toBeNull()
    expect(constraint!.pointRefs).toEqual(['end', 'start'])
    expect(constraint!.entityIds).toEqual([first.id, second.id])
  })

  it('joins reversed geometry by proximity rather than by name', () => {
    const first = line([0, 0], [10, 0])
    // Drawn the other way, so its *end* is the one near the first line's start.
    const second = line([-10, 5], [0.01, 0])
    const constraint = buildConstraint('coincident', [first, second], [first.id, second.id])
    expect(constraint!.pointRefs).toEqual(['start', 'end'])
  })

  it('makes concentric refer to both centres', () => {
    const first = circle([0, 0], 5)
    const second = circle([1, 1], 8)
    const constraint = buildConstraint('concentric', [first, second], [first.id, second.id])
    expect(constraint!.pointRefs).toEqual(['center', 'center'])
  })

  it('refuses a constraint the selection cannot support', () => {
    const entities = [line([0, 0], [10, 0]), line([0, 5], [10, 5])]
    expect(buildConstraint('tangent', entities, entities.map((entity) => entity.id))).toBeNull()
  })

  it('refuses axis alignment on anything but one line', () => {
    const round = circle([0, 0], 5)
    expect(buildConstraint('horizontal', [round], [round.id])).toBeNull()
  })

  it('gives every constraint its own id', () => {
    const entities = [line([0, 0], [10, 0]), line([0, 5], [10, 5])]
    const ids = entities.map((entity) => entity.id)
    const first = buildConstraint('parallel', entities, ids)
    const second = buildConstraint('parallel', entities, ids)
    expect(first!.id).not.toBe(second!.id)
  })
})

describe('describeConstraint', () => {
  it('names entities by kind and position in the sketch', () => {
    const entities = [line([0, 0], [10, 0]), circle([5, 5], 2), arc([0, 0], 3, 0, HALF_PI)]
    const constraint = buildConstraint('concentric', entities, [entities[1].id, entities[2].id])
    expect(describeConstraint(constraint!, entities)).toBe('Circle 2 · Arc 3')
  })

  it('marks an entity that is no longer there', () => {
    const entities = [line([0, 0], [10, 0])]
    expect(describeConstraint(
      { id: 'c', type: 'parallel', entityIds: [entities[0].id, 'gone'] },
      entities,
    )).toBe('Line 1 · ?')
  })
})
