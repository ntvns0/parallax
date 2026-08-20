import { describe, expect, it } from 'vitest'
import { createFeature, createId, type SketchFeature } from './model'
import {
  connectedSketchEntityIds,
  getClosedProfiles,
  getProfileRegions,
  positionSketchEntities,
  resolveSketchAnchor,
  scaleSketchEntities,
  sketchAnchorPoint,
  sketchEntitySelectionCenter,
  translateSketchEntities,
} from './sketch'

function rectangle(): SketchFeature {
  const sketch = createFeature('sketch', 1) as SketchFeature
  const points = [[0, 0], [40, 0], [40, 20], [0, 20]] as const
  sketch.entities = points.map((start, index) => ({
    id: createId(),
    type: 'line' as const,
    start: [...start],
    end: [...points[(index + 1) % points.length]],
    construction: false,
  }))
  return sketch
}

function circle(sketch: SketchFeature, center: [number, number], radius: number) {
  sketch.entities.push({ id: createId(), type: 'circle', center, radius, construction: false })
  return sketch
}

describe('profile regions', () => {
  it('treats a circle inside a rectangle as a hole in it', () => {
    const regions = getProfileRegions(circle(rectangle(), [20, 10], 4))

    expect(regions).toHaveLength(1)
    expect(regions[0].outer.type).toBe('polygon')
    expect(regions[0].holes).toHaveLength(1)
  })

  it('keeps a circle outside the rectangle as its own region', () => {
    const regions = getProfileRegions(circle(rectangle(), [100, 10], 4))

    expect(regions).toHaveLength(2)
    expect(regions.every((region) => region.holes.length === 0)).toBe(true)
  })

  it('applies the even-odd rule so an island inside a hole is solid again', () => {
    const sketch = rectangle()
    circle(sketch, [20, 10], 8)
    circle(sketch, [20, 10], 3)
    const regions = getProfileRegions(sketch)

    // Rectangle (depth 0) holds the big circle as a hole (depth 1); the small
    // circle nested inside it (depth 2) becomes material again.
    expect(regions).toHaveLength(2)
    const plate = regions.find((region) => region.outer.type === 'polygon')
    const island = regions.find((region) => region.outer.type === 'circle')
    expect(plate?.holes).toHaveLength(1)
    expect(island?.holes).toHaveLength(0)
    expect(island?.outer.type === 'circle' && island.outer.radius).toBe(3)
  })

  it('assigns a hole to its immediate parent rather than the outermost one', () => {
    const sketch = rectangle()
    circle(sketch, [20, 10], 8)
    circle(sketch, [20, 10], 5)
    circle(sketch, [20, 10], 2)
    const regions = getProfileRegions(sketch)

    const island = regions.find((region) => region.outer.type === 'circle' && region.outer.radius === 5)
    expect(island?.holes).toHaveLength(1)
    expect(island?.holes[0].type === 'circle' && island.holes[0].radius).toBe(2)
  })

  it('finds nothing in an open sketch', () => {
    const sketch = createFeature('sketch', 1) as SketchFeature
    sketch.entities = [{ id: createId(), type: 'line', start: [0, 0], end: [10, 0], construction: false }]
    expect(getProfileRegions(sketch)).toHaveLength(0)
  })

  it('finds both adjacent regions when two boxes share an edge', () => {
    const sketch = rectangle()
    sketch.entities.push(
      { id: createId(), type: 'line', start: [40, 0], end: [60, 0], construction: false },
      { id: createId(), type: 'line', start: [60, 0], end: [60, 20], construction: false },
      { id: createId(), type: 'line', start: [60, 20], end: [40, 20], construction: false },
    )

    const regions = getProfileRegions(sketch)
    expect(regions).toHaveLength(2)
    expect(regions.every((region) => region.outer.type === 'polygon' && region.holes.length === 0)).toBe(true)
  })

  it('implicitly splits a line at T-junctions when finding bounded faces', () => {
    const sketch = rectangle()
    sketch.entities.push({
      id: createId(), type: 'line', start: [20, 0], end: [20, 20], construction: false,
    })

    expect(getProfileRegions(sketch)).toHaveLength(2)
  })

  it('finds an attached region whose ends land within an existing side', () => {
    const sketch = rectangle()
    sketch.entities.push(
      { id: createId(), type: 'line', start: [40, 5], end: [55, 5], construction: false },
      { id: createId(), type: 'line', start: [55, 5], end: [55, 15], construction: false },
      { id: createId(), type: 'line', start: [55, 15], end: [40, 15], construction: false },
    )

    expect(getProfileRegions(sketch)).toHaveLength(2)
  })
})

describe('sketch anchor', () => {
  it('anchors a line at its start point', () => {
    const sketch = rectangle()
    const anchor = resolveSketchAnchor(sketch.entities, undefined)
    expect(anchor).toEqual({ entityId: sketch.entities[0].id, point: 'start' })
    expect(sketchAnchorPoint(sketch.entities, anchor)).toEqual([0, 0])
  })

  it('keeps a recorded anchor regardless of entity order', () => {
    const sketch = rectangle()
    const recorded = { entityId: sketch.entities[2].id, point: 'start' as const }
    const reordered = [...sketch.entities].reverse()
    expect(resolveSketchAnchor(reordered, recorded)).toEqual(recorded)
  })

  it('rehomes to the oldest survivor when the anchored entity is gone', () => {
    const sketch = rectangle()
    const removed = { entityId: 'deleted', point: 'start' as const }
    expect(resolveSketchAnchor(sketch.entities, removed)).toEqual({ entityId: sketch.entities[0].id, point: 'start' })
  })

  it('has no anchor for an empty sketch', () => {
    expect(resolveSketchAnchor([], undefined)).toBeUndefined()
    expect(sketchAnchorPoint([], undefined)).toBeNull()
  })
})

describe('sketch profiles', () => {
  it('recognizes an unordered closed rectangle', () => {
    const sketch = rectangle()
    sketch.entities = [sketch.entities[2], sketch.entities[0], sketch.entities[3], sketch.entities[1]]
    expect(getClosedProfiles(sketch)).toHaveLength(1)
  })

  it('resizes geometry around its center', () => {
    const sketch = rectangle()
    const scaled = scaleSketchEntities(sketch.entities, 0, 80)
    const xs = scaled.flatMap((entity) => entity.type === 'line' ? [entity.start[0], entity.end[0]] : [])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80)
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(20)
  })

  it('moves a connected profile without changing its size', () => {
    const sketch = rectangle()
    for (let index = 0; index < sketch.entities.length; index += 1) {
      sketch.constraints.push({
        id: createId(),
        type: 'coincident',
        entityIds: [sketch.entities[index].id, sketch.entities[(index + 1) % sketch.entities.length].id],
        pointRefs: ['end', 'start'],
      })
    }
    const connected = connectedSketchEntityIds(sketch, sketch.entities[0].id)
    const moved = translateSketchEntities(sketch.entities, connected, [12, -7])
    const first = moved[0]
    expect(connected.size).toBe(4)
    expect(first.type === 'line' ? first.start : null).toEqual([12, -7])
    expect(getClosedProfiles({ ...sketch, entities: moved })).toHaveLength(1)
  })

  it('positions geometry by the center of its bounds', () => {
    const sketch = rectangle()
    const entityIds = new Set(sketch.entities.map((entity) => entity.id))
    const positioned = positionSketchEntities(sketch.entities, entityIds, [0, 0])

    expect(sketchEntitySelectionCenter(positioned, entityIds)).toEqual([0, 0])
    expect(positioned[0].type === 'line' ? positioned[0].start : null).toEqual([-20, -10])
    expect(getClosedProfiles({ ...sketch, entities: positioned })).toHaveLength(1)
  })
})
