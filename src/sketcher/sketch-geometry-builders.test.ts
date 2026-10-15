import { describe, expect, it } from 'vitest'
import { arcEndPoint, arcStartPoint } from '../core/arc-geometry'
import { getProfileRegions } from '../core/sketch'
import { createFeature, type ArcEntity, type LineEntity, type SketchFeature, type Vec2 } from '../core/model'
import {
  centrePointArcGeometry,
  circleGeometry,
  distance,
  lineGeometry,
  rectangleGeometry,
  snapConstraints,
  tangentArcGeometry,
  threePointArcGeometry,
  type ActiveSnap,
} from './sketch-geometry-builders'

function sketchWith(entities: SketchFeature['entities']): SketchFeature {
  const sketch = createFeature('sketch', 1) as SketchFeature
  sketch.entities = entities
  return sketch
}

describe('rectangleGeometry', () => {
  it('closes into one region with square corners and both sizes dimensioned', () => {
    const { entities, constraints } = rectangleGeometry([0, 0], [40, -30])

    expect(getProfileRegions(sketchWith(entities))).toHaveLength(1)
    expect(constraints.filter((c) => c.type === 'horizontal')).toHaveLength(2)
    expect(constraints.filter((c) => c.type === 'vertical')).toHaveLength(2)
    expect(constraints.filter((c) => c.type === 'coincident')).toHaveLength(4)
    expect(constraints.filter((c) => c.type === 'distance').map((c) => c.value)).toEqual([40, 30])
  })
})

describe('circleGeometry', () => {
  it('dimensions the radius it was drawn with', () => {
    const { entities, constraints } = circleGeometry([1, 1], [4, 5])
    expect(entities[0]).toMatchObject({ type: 'circle', center: [1, 1], radius: 5 })
    expect(constraints[0]).toMatchObject({ type: 'radius', value: 5 })
  })
})

describe('lineGeometry', () => {
  it('holds a level line horizontal', () => {
    expect(lineGeometry([0, 0], [10, 0], null, null, null).constraints.map((c) => c.type)).toEqual(['horizontal'])
  })

  it('holds a sloped line at its inferred angle', () => {
    const { constraints } = lineGeometry([0, 0], [10, 10], 45, null, null)
    expect(constraints).toEqual([expect.objectContaining({ type: 'angle', value: 45 })])
  })

  it('ties both ends to what they snapped to', () => {
    const endpoint: ActiveSnap = { source: 'entity', kind: 'endpoint', point: [0, 0], entityIds: ['other'], pointRef: 'end' }
    const midpoint: ActiveSnap = { source: 'entity', kind: 'midpoint', point: [5, 5], entityIds: ['third'] }
    const { entities, constraints } = lineGeometry([0, 0], [5, 5], null, endpoint, midpoint)

    expect(constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'coincident', entityIds: [entities[0].id, 'other'], pointRefs: ['start', 'end'] }),
      expect.objectContaining({ type: 'midpoint', entityIds: [entities[0].id, 'third'], pointRefs: ['end'] }),
    ]))
  })
})

describe('snapConstraints', () => {
  it('places a point on a ruler division at its distance', () => {
    const division: ActiveSnap = { source: 'entity', kind: 'division', point: [3, 0], entityIds: ['ruled'], pointRef: 'start', distance: 3 }
    expect(snapConstraints('new', 'end', division).map((c) => [c.type, c.value])).toEqual([['pointOnLine', undefined], ['pointDistance', 3]])
  })

  it('adds nothing for a face snap, which has no sketch geometry to hold to', () => {
    const face = { source: 'face', kind: 'center', point: [0, 0] } as ActiveSnap
    expect(snapConstraints('new', 'start', face)).toEqual([])
  })
})

describe('arc builders', () => {
  it('sweeps a centre-point arc from its start point', () => {
    const addition = centrePointArcGeometry([0, 0], [10, 0], [0, 10])!
    const arc = addition.entities[0] as ArcEntity
    expect(arc.radius).toBeCloseTo(10, 9)
    expect(addition.constraints[0]).toMatchObject({ type: 'radius' })
  })

  it('passes a three-point arc through all three points', () => {
    const arc = threePointArcGeometry([10, 0], [-10, 0], [0, 10])!.entities[0] as ArcEntity
    expect(arc.radius).toBeCloseTo(10, 9)
  })

  it('joins a tangent arc to the end it left from', () => {
    const line: LineEntity = { id: 'line', type: 'line', start: [0, 0], end: [10, 0], construction: false }
    const addition = tangentArcGeometry({ entityId: line.id, pointRef: 'end', point: line.end, tangent: [1, 0] }, [15, 5])!
    const arc = addition.entities[0] as ArcEntity
    const joined = [arcStartPoint(arc), arcEndPoint(arc)].some((point: Vec2) => distance(point, line.end) < 1e-9)

    expect(joined).toBe(true)
    expect(addition.constraints.map((c) => c.type)).toEqual(['coincident', 'tangent', 'radius'])
  })
})
