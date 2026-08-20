import { describe, expect, it } from 'vitest'
import { filletSketchCorner } from './sketch-fillet'
import { arcEndPoint, arcStartPoint } from '../core/arc-geometry'
import type { ArcEntity, LineEntity, SketchConstraint, SketchEntity, Vec2 } from '../core/model'

const line = (id: string, start: Vec2, end: Vec2): LineEntity => ({ id, type: 'line', start, end, construction: false })

/** Perpendicular distance from a point to the infinite line through an entity. */
function distanceToInfiniteLine(entity: LineEntity, point: Vec2) {
  const dx = entity.end[0] - entity.start[0]
  const dy = entity.end[1] - entity.start[1]
  const magnitude = Math.hypot(dx, dy)
  return Math.abs((point[0] - entity.start[0]) * dy - (point[1] - entity.start[1]) * dx) / magnitude
}

function succeed(result: ReturnType<typeof filletSketchCorner>) {
  if (!result.ok) throw new Error(`expected a fillet, got: ${result.reason}`)
  return result
}

describe('filletSketchCorner', () => {
  // A right-angled corner at the origin: one line east, one line north.
  const east = line('a', [0, 0], [10, 0])
  const north = line('b', [0, 0], [0, 10])
  const corner: SketchEntity[] = [east, north]

  it('rounds a right angle, leaving an arc tangent to both lines', () => {
    const result = succeed(filletSketchCorner(corner, [], 'a', 'b', 3))
    const arc = result.entities.find((entity) => entity.id === result.arcId) as ArcEntity

    // Tangency is the property that matters: the centre sits exactly one radius
    // from each line, and the arc's ends land on them.
    expect(distanceToInfiniteLine(east, arc.center)).toBeCloseTo(3, 9)
    expect(distanceToInfiniteLine(north, arc.center)).toBeCloseTo(3, 9)
    expect(arc.center).toEqual([3, 3])
    expect(arc.radius).toBe(3)
    // A quarter turn for a right-angled corner.
    expect(arc.endAngle - arc.startAngle).toBeCloseTo(Math.PI / 2, 9)
  })

  it('cuts both lines back to the tangent points and keeps their far ends', () => {
    const result = succeed(filletSketchCorner(corner, [], 'a', 'b', 3))
    const trimmedEast = result.entities.find((entity) => entity.id === 'a') as LineEntity
    const trimmedNorth = result.entities.find((entity) => entity.id === 'b') as LineEntity

    expect(trimmedEast.start[0]).toBeCloseTo(3, 9)
    expect(trimmedEast.start[1]).toBeCloseTo(0, 9)
    expect(trimmedEast.end).toEqual([10, 0])
    expect(trimmedNorth.start[0]).toBeCloseTo(0, 9)
    expect(trimmedNorth.start[1]).toBeCloseTo(3, 9)
    expect(trimmedNorth.end).toEqual([0, 10])
  })

  it('joins the arc to the line ends it was cut from, in the right order', () => {
    const result = succeed(filletSketchCorner(corner, [], 'a', 'b', 3))
    const arc = result.entities.find((entity) => entity.id === result.arcId) as ArcEntity
    const trimmedEast = result.entities.find((entity) => entity.id === 'a') as LineEntity
    const trimmedNorth = result.entities.find((entity) => entity.id === 'b') as LineEntity

    const ends = [arcStartPoint(arc), arcEndPoint(arc)]
    // Whichever way round the arc runs, one end meets each line's cut end.
    const meets = (point: Vec2) => ends.some((end) => Math.hypot(end[0] - point[0], end[1] - point[1]) < 1e-9)
    expect(meets(trimmedEast.start)).toBe(true)
    expect(meets(trimmedNorth.start)).toBe(true)

    // And the coincidence constraints name the same pairing the geometry has.
    const coincidences = result.constraints.filter((constraint) => constraint.type === 'coincident')
    expect(coincidences).toHaveLength(2)
    for (const constraint of coincidences) {
      const lineId = constraint.entityIds[0]
      const linePoint = (result.entities.find((entity) => entity.id === lineId) as LineEntity)[constraint.pointRefs![0] as 'start' | 'end']
      const arcPoint = constraint.pointRefs![1] === 'start' ? arcStartPoint(arc) : arcEndPoint(arc)
      expect(Math.hypot(arcPoint[0] - linePoint[0], arcPoint[1] - linePoint[1])).toBeLessThan(1e-9)
    }
  })

  it('constrains the corner so the radius stays editable and the arc cannot drift', () => {
    const result = succeed(filletSketchCorner(corner, [], 'a', 'b', 3))
    const types = result.constraints.map((constraint) => constraint.type).sort()
    expect(types).toEqual(['coincident', 'coincident', 'radius', 'tangent', 'tangent'])
    const radius = result.constraints.find((constraint) => constraint.type === 'radius')!
    expect(radius.value).toBe(3)
    expect(radius.entityIds).toEqual([result.arcId])
  })

  it('rounds an acute corner, sweeping more than a quarter turn', () => {
    // 45° between the lines, so the fillet sweeps the 135° supplement.
    const diagonal = line('b', [0, 0], [10, 10])
    const result = succeed(filletSketchCorner([east, diagonal], [], 'a', 'b', 2))
    const arc = result.entities.find((entity) => entity.id === result.arcId) as ArcEntity
    expect(arc.endAngle - arc.startAngle).toBeCloseTo((135 * Math.PI) / 180, 9)
    expect(distanceToInfiniteLine(east, arc.center)).toBeCloseTo(2, 9)
    expect(distanceToInfiniteLine(diagonal, arc.center)).toBeCloseTo(2, 9)
  })

  it('rounds a corner where the lines cross rather than meet, cutting the short sides', () => {
    // The corner is interior to both lines; the stubs past it are removed.
    const across = line('a', [-2, 0], [10, 0])
    const up = line('b', [0, -2], [0, 10])
    const result = succeed(filletSketchCorner([across, up], [], 'a', 'b', 3))
    const trimmedAcross = result.entities.find((entity) => entity.id === 'a') as LineEntity
    expect(trimmedAcross.start[0]).toBeCloseTo(3, 9)
    expect(trimmedAcross.end).toEqual([10, 0])
  })

  it('keeps the far-end constraints and drops the ones the fillet invalidates', () => {
    const constraints: SketchConstraint[] = [
      { id: 'corner', type: 'coincident', entityIds: ['a', 'b'], pointRefs: ['start', 'start'] },
      { id: 'lengthA', type: 'distance', entityIds: ['a'], value: 10 },
      { id: 'horizontal', type: 'horizontal', entityIds: ['a'] },
      { id: 'vertical', type: 'vertical', entityIds: ['b'] },
      { id: 'elsewhere', type: 'coincident', entityIds: ['a', 'c'], pointRefs: ['end', 'start'] },
    ]
    const result = succeed(filletSketchCorner(corner, constraints, 'a', 'b', 3))
    const kept = result.constraints.filter((constraint) => ['corner', 'lengthA', 'horizontal', 'vertical', 'elsewhere'].includes(constraint.id))
    // The corner coincidence is now the arc's job, and the length dimension no
    // longer describes the shortened line. Direction and the far-end join stay.
    expect(kept.map((constraint) => constraint.id).sort()).toEqual(['elsewhere', 'horizontal', 'vertical'])
  })

  it('reports the largest radius that would fit instead of failing silently', () => {
    const shortEast = line('a', [0, 0], [4, 0])
    const result = filletSketchCorner([shortEast, north], [], 'a', 'b', 8)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/larger than these lines can carry/)
    // A right angle has tan(45°) = 1, so the limit is the shorter line itself.
    expect(result.maximumRadius).toBeCloseTo(4, 9)
    // And that reported radius does fit.
    expect(filletSketchCorner([shortEast, north], [], 'a', 'b', result.maximumRadius! - 1e-6).ok).toBe(true)
  })

  it('refuses the corners that are not corners, and unsupported geometry', () => {
    const parallel = filletSketchCorner([east, line('b', [0, 5], [10, 5])], [], 'a', 'b', 1)
    expect(parallel.ok === false && parallel.reason).toMatch(/parallel/)

    // Two collinear lines are a parallel pair, so they are caught by the same
    // check rather than reaching the included-angle guard.
    const collinear = filletSketchCorner([east, line('b', [12, 0], [20, 0])], [], 'a', 'b', 1)
    expect(collinear.ok === false && collinear.reason).toMatch(/parallel/)

    const circle: SketchEntity = { id: 'b', type: 'circle', center: [0, 0], radius: 4, construction: false }
    const round = filletSketchCorner([east, circle], [], 'a', 'b', 1)
    expect(round.ok === false && round.reason).toMatch(/between two lines/)

    expect(filletSketchCorner(corner, [], 'a', 'b', 0).ok).toBe(false)
    expect(filletSketchCorner(corner, [], 'a', 'a', 1).ok).toBe(false)
    expect(filletSketchCorner(corner, [], 'a', 'missing', 1).ok).toBe(false)
  })

  it('does not mutate the sketch it was given', () => {
    const input: SketchEntity[] = [line('a', [0, 0], [10, 0]), line('b', [0, 0], [0, 10])]
    const snapshot = structuredClone(input)
    filletSketchCorner(input, [], 'a', 'b', 3)
    expect(input).toEqual(snapshot)
  })
})
