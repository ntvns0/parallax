import { describe, expect, it } from 'vitest'
import { intersectSketchEntities, pickTrimTarget, trimRemovalPreview, trimSketchEntity } from './trim'
import { arcEndPoint, arcStartPoint, normalizeArc } from '../core/arc-geometry'
import type { ArcEntity, CircleEntity, LineEntity, SketchConstraint, SketchEntity, Vec2 } from '../core/model'

const line = (id: string, start: Vec2, end: Vec2): LineEntity => ({ id, type: 'line', start, end, construction: false })
const circle = (id: string, center: Vec2, radius: number): CircleEntity => ({ id, type: 'circle', center, radius, construction: false })

function arc(id: string, center: Vec2, radius: number, startAngle: number, endAngle: number): ArcEntity {
  const normalized = normalizeArc(center, radius, startAngle, endAngle)
  return { id, type: 'arc', center, radius, startAngle: normalized.startAngle, endAngle: normalized.endAngle, construction: false }
}

const sorted = (points: Vec2[]) => [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])

function expectPoints(actual: Vec2[], expected: Vec2[]) {
  expect(actual).toHaveLength(expected.length)
  sorted(actual).forEach((point, index) => {
    expect(point[0]).toBeCloseTo(sorted(expected)[index][0], 9)
    expect(point[1]).toBeCloseTo(sorted(expected)[index][1], 9)
  })
}

describe('intersectSketchEntities', () => {
  it('crosses two lines, and only within both their lengths', () => {
    expectPoints(intersectSketchEntities(line('a', [0, 0], [10, 0]), line('b', [5, -5], [5, 5])), [[5, 0]])
    // The second line stops short: the infinite lines cross, the segments do not.
    expect(intersectSketchEntities(line('a', [0, 0], [10, 0]), line('b', [5, 2], [5, 5]))).toEqual([])
  })

  it('leaves parallel and collinear lines alone', () => {
    expect(intersectSketchEntities(line('a', [0, 0], [10, 0]), line('b', [0, 3], [10, 3]))).toEqual([])
    expect(intersectSketchEntities(line('a', [0, 0], [10, 0]), line('b', [5, 0], [15, 0]))).toEqual([])
  })

  it('crosses a line and a circle in both directions of the argument order', () => {
    const l = line('a', [-10, 0], [10, 0])
    const c = circle('b', [0, 0], 4)
    expectPoints(intersectSketchEntities(l, c), [[-4, 0], [4, 0]])
    expectPoints(intersectSketchEntities(c, l), [[-4, 0], [4, 0]])
  })

  it('reports a tangent line and a circle as one point', () => {
    expectPoints(intersectSketchEntities(line('a', [-10, 4], [10, 4]), circle('b', [0, 0], 4)), [[0, 4]])
  })

  it('crosses two circles, and reports nothing when they are apart, nested or concentric', () => {
    expectPoints(intersectSketchEntities(circle('a', [0, 0], 5), circle('b', [8, 0], 5)), [[4, 3], [4, -3]])
    expect(intersectSketchEntities(circle('a', [0, 0], 2), circle('b', [10, 0], 2))).toEqual([])
    expect(intersectSketchEntities(circle('a', [0, 0], 10), circle('b', [1, 0], 2))).toEqual([])
    expect(intersectSketchEntities(circle('a', [0, 0], 5), circle('b', [0, 0], 5))).toEqual([])
  })

  it('limits an arc to its own sweep', () => {
    const upper = arc('a', [0, 0], 4, 0, Math.PI) // The top half.
    const crossing = line('b', [-10, 0], [10, 0])
    // Both ends of the diameter lie on the full circle; only the sweep's own
    // endpoints belong to this arc.
    expectPoints(intersectSketchEntities(upper, crossing), [[4, 0], [-4, 0]])
    const below = line('c', [0, -10], [0, -1])
    expect(intersectSketchEntities(upper, below)).toEqual([])
  })
})

describe('trimSketchEntity', () => {
  it('removes the middle span of a line between two crossings', () => {
    const target = line('t', [0, 0], [10, 0])
    const entities: SketchEntity[] = [target, line('a', [3, -2], [3, 2]), line('b', [7, -2], [7, 2])]
    const outcome = trimSketchEntity(entities, [], 't', [5, 0])!

    expect(outcome.remainingPieces).toBe(2)
    const pieces = outcome.entities.filter((entity) => entity.type === 'line' && entity.id !== 'a' && entity.id !== 'b')
    expect(pieces).toHaveLength(2)
    expect((pieces[0] as LineEntity).start).toEqual([0, 0])
    expect((pieces[0] as LineEntity).end[0]).toBeCloseTo(3, 9)
    expect((pieces[1] as LineEntity).start[0]).toBeCloseTo(7, 9)
    expect((pieces[1] as LineEntity).end).toEqual([10, 0])
    // The other geometry is untouched and stays in place.
    expect(outcome.entities.filter((entity) => entity.id === 'a' || entity.id === 'b')).toHaveLength(2)
  })

  it('cuts back to the single crossing when the click is past the last one', () => {
    const entities: SketchEntity[] = [line('t', [0, 0], [10, 0]), line('a', [4, -2], [4, 2])]
    const outcome = trimSketchEntity(entities, [], 't', [8, 0])!
    expect(outcome.remainingPieces).toBe(1)
    const piece = outcome.entities.find((entity) => entity.id === 't') as LineEntity
    expect(piece.start).toEqual([0, 0])
    expect(piece.end[0]).toBeCloseTo(4, 9)
  })

  it('cuts the near end when the click is before the first crossing', () => {
    const entities: SketchEntity[] = [line('t', [0, 0], [10, 0]), line('a', [4, -2], [4, 2])]
    const outcome = trimSketchEntity(entities, [], 't', [1, 0])!
    const piece = outcome.entities.find((entity) => entity.id === 't') as LineEntity
    expect(piece.start[0]).toBeCloseTo(4, 9)
    expect(piece.end).toEqual([10, 0])
  })

  it('deletes an entity that nothing crosses', () => {
    const outcome = trimSketchEntity([line('t', [0, 0], [10, 0])], [], 't', [5, 0])!
    expect(outcome.remainingPieces).toBe(0)
    expect(outcome.entities).toEqual([])
  })

  it('turns a trimmed circle into the arc that survives', () => {
    // A circle of radius 5 cut by a vertical line at x=4: clicking the small
    // right-hand cap removes it and leaves the major arc.
    const entities: SketchEntity[] = [circle('t', [0, 0], 5), line('a', [4, -6], [4, 6])]
    const outcome = trimSketchEntity(entities, [], 't', [5, 0])!

    expect(outcome.remainingPieces).toBe(1)
    const survivor = outcome.entities.find((entity) => entity.id === 't')!
    expect(survivor.type).toBe('arc')
    const kept = survivor as ArcEntity
    // The survivor runs from the upper crossing round to the lower one, so it
    // passes through the far side of the circle and is the major arc.
    expect(kept.endAngle - kept.startAngle).toBeGreaterThan(Math.PI)
    expect(arcStartPoint(kept)[0]).toBeCloseTo(4, 9)
    expect(arcEndPoint(kept)[0]).toBeCloseTo(4, 9)
  })

  it('deletes a circle that fewer than two curves cross', () => {
    const entities: SketchEntity[] = [circle('t', [0, 0], 5), line('a', [5, -6], [5, 6])]
    const outcome = trimSketchEntity(entities, [], 't', [-5, 0])!
    expect(outcome.remainingPieces).toBe(0)
    expect(outcome.entities.map((entity) => entity.id)).toEqual(['a'])
  })

  it('trims an arc within its own sweep', () => {
    const target = arc('t', [0, 0], 5, 0, Math.PI) // Top half, counter-clockwise.
    const entities: SketchEntity[] = [target, line('a', [0, -6], [0, 6])]
    // Click the left quarter, past the crossing at the top of the arc.
    const outcome = trimSketchEntity(entities, [], 't', [-5, 0.001])!
    expect(outcome.remainingPieces).toBe(1)
    const kept = outcome.entities.find((entity) => entity.id === 't') as ArcEntity
    expect(kept.startAngle).toBeCloseTo(0, 9)
    expect(kept.endAngle).toBeCloseTo(Math.PI / 2, 9)
  })

  it('returns null for a click that means nothing', () => {
    expect(trimSketchEntity([line('t', [0, 0], [10, 0])], [], 'missing', [5, 0])).toBeNull()
  })

  describe('constraints', () => {
    const target = line('t', [0, 0], [10, 0])
    const entities: SketchEntity[] = [target, line('a', [3, -2], [3, 2]), line('b', [7, -2], [7, 2])]

    it('drops constraints that no longer describe the trimmed geometry', () => {
      const constraints: SketchConstraint[] = [
        { id: 'c1', type: 'distance', entityIds: ['t'], value: 10 },
        { id: 'c2', type: 'coincident', entityIds: ['t', 'a'], pointRefs: ['start', 'start'] },
        { id: 'c3', type: 'vertical', entityIds: ['a'] },
      ]
      const outcome = trimSketchEntity(entities, constraints, 't', [5, 0])!
      // The length dimension and the endpoint coincidence both referred to
      // geometry that no longer exists in that form; the unrelated one stays.
      expect(outcome.constraints.map((constraint) => constraint.id)).toEqual(['c3'])
    })

    it('carries a direction constraint onto every surviving piece', () => {
      const outcome = trimSketchEntity(entities, [{ id: 'c1', type: 'horizontal', entityIds: ['t'] }], 't', [5, 0])!
      const carried = outcome.constraints.filter((constraint) => constraint.type === 'horizontal')
      expect(carried).toHaveLength(2)
      // Fresh ids, one per piece, so nothing points at geometry that is gone.
      expect(new Set(carried.map((constraint) => constraint.id)).size).toBe(2)
      const pieceIds = outcome.entities.filter((entity) => entity.type === 'line' && !['a', 'b'].includes(entity.id)).map((entity) => entity.id)
      expect(carried.flatMap((constraint) => constraint.entityIds).sort()).toEqual([...pieceIds].sort())
    })

    it('keeps a radius on the arc a trimmed circle becomes', () => {
      const outcome = trimSketchEntity(
        [circle('t', [0, 0], 5), line('a', [4, -6], [4, 6])],
        [{ id: 'c1', type: 'radius', entityIds: ['t'], value: 5 }],
        't',
        [5, 0],
      )!
      const radius = outcome.constraints.filter((constraint) => constraint.type === 'radius')
      expect(radius).toHaveLength(1)
      expect(radius[0].value).toBe(5)
      expect(radius[0].entityIds).toEqual(['t'])
    })
  })
})

describe('trimRemovalPreview', () => {
  it('previews exactly the span the trim would remove', () => {
    const entities: SketchEntity[] = [line('t', [0, 0], [10, 0]), line('a', [3, -2], [3, 2]), line('b', [7, -2], [7, 2])]
    const preview = trimRemovalPreview(entities, 't', [5, 0])!
    expect(preview).toHaveLength(2)
    expect(preview[0][0]).toBeCloseTo(3, 9)
    expect(preview[1][0]).toBeCloseTo(7, 9)

    // And it agrees with what the edit actually does: the removed span runs
    // between the two ends the surviving pieces stop at.
    const outcome = trimSketchEntity(entities, [], 't', [5, 0])!
    const survivors = outcome.entities.filter((entity): entity is LineEntity => entity.type === 'line' && !['a', 'b'].includes(entity.id))
    expect(survivors[0].end[0]).toBeCloseTo(preview[0][0], 9)
    expect(survivors[1].start[0]).toBeCloseTo(preview[1][0], 9)
  })

  it('previews the whole curve when nothing crosses it', () => {
    const preview = trimRemovalPreview([line('t', [0, 0], [10, 0])], 't', [5, 0])!
    expect(preview[0]).toEqual([0, 0])
    expect(preview[1]).toEqual([10, 0])
  })

  it('previews the cap of a circle, crossing the seam at angle zero if it must', () => {
    // Crossings at ±37° either side of angle 0, click at angle 0: the removed
    // span wraps through the seam, so the preview must too.
    const entities: SketchEntity[] = [circle('t', [0, 0], 5), line('a', [4, -6], [4, 6])]
    const preview = trimRemovalPreview(entities, 't', [5, 0])!
    for (const point of preview) {
      expect(Math.hypot(point[0], point[1])).toBeCloseTo(5, 9)
      // Every sampled point is on the removed cap, right of the cutting line.
      expect(point[0]).toBeGreaterThanOrEqual(4 - 1e-9)
    }
  })

  it('previews the whole circle when fewer than two curves cross it', () => {
    const preview = trimRemovalPreview([circle('t', [0, 0], 5)], 't', [5, 0])!
    const xs = preview.map((point) => point[0])
    expect(Math.min(...xs)).toBeLessThan(-4.9)
    expect(Math.max(...xs)).toBeGreaterThan(4.9)
  })
})

describe('pickTrimTarget', () => {
  const entities: SketchEntity[] = [line('l', [0, 0], [10, 0]), circle('c', [0, 0], 8)]

  it('picks the curve under the pointer, not the shape the pointer is inside', () => {
    // Inside the big circle but sitting on the line: the line wins, because
    // distance is measured to the curve rather than to an enclosed area.
    expect(pickTrimTarget(entities, [5, 0.05], 0.5)?.id).toBe('l')
    expect(pickTrimTarget(entities, [8.05, 0.4], 0.5)?.id).toBe('c')
  })

  it('finds nothing when the pointer is not near any curve', () => {
    expect(pickTrimTarget(entities, [3, 3], 0.5)).toBeNull()
  })

  it('measures to an arc endpoint rather than round the circle it was cut from', () => {
    const upper = [arc('a', [0, 0], 5, 0, Math.PI)]
    expect(pickTrimTarget(upper, [0, 5.1], 0.5)?.id).toBe('a')
    // Below the arc's own sweep: nearest point is its endpoint, which is far.
    expect(pickTrimTarget(upper, [0, -5], 0.5)).toBeNull()
  })
})
