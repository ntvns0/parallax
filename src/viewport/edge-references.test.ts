import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../core/model'
import { edgeSnapReferences, pickEdgeChain, polylineMidpoint, type EdgeSegment } from './edge-references'

const feature = { id: 'plate', name: 'Plate', kind: 'extrude' as const }

/** The outline of a 40 × 20 rectangle at z = 0, one segment per side, each side its own edge. */
const square: EdgeSegment[] = [
  { start: [0, 0, 0], end: [40, 0, 0] },
  { start: [40, 0, 0], end: [40, 20, 0] },
  { start: [40, 20, 0], end: [0, 20, 0] },
  { start: [0, 20, 0], end: [0, 0, 0] },
]
const squareGroups = square.map((_, index) => ({ start: index * 2, count: 2 }))

/** An open arc of radius 10 about the origin, as one edge of many segments. */
function arc(segmentCount: number, sweep: number): EdgeSegment[] {
  const at = (index: number): Vec3 => {
    const angle = (index / segmentCount) * sweep
    return [10 * Math.cos(angle), 10 * Math.sin(angle), 0]
  }
  return Array.from({ length: segmentCount }, (_, index) => ({ start: at(index), end: at(index + 1) }))
}

describe('polylineMidpoint', () => {
  it('is halfway along the chain, not halfway between its ends', () => {
    const bent: EdgeSegment[] = [{ start: [0, 0, 0], end: [30, 0, 0] }, { start: [30, 0, 0], end: [30, 10, 0] }]
    expect(polylineMidpoint(bent)).toEqual([20, 0, 0])
  })
})

describe('edgeSnapReferences', () => {
  it('offers each corner once and each side’s midpoint', () => {
    const references = edgeSnapReferences(square, squareGroups, feature)
    const of = (type: string) => references.filter((reference) => reference.snapType === type).map((reference) => reference.point)
    expect(of('vertex')).toHaveLength(4)
    expect(of('edge midpoint')).toEqual([[20, 0, 0], [40, 10, 0], [20, 20, 0], [0, 10, 0]])
  })

  it('treats a curved edge as one edge, with one midpoint along the curve', () => {
    const quarter = arc(16, Math.PI / 2)
    const references = edgeSnapReferences(quarter, [{ start: 0, count: 32 }], feature)
    expect(references.filter((reference) => reference.snapType === 'vertex')).toHaveLength(2)
    const [midpoint] = references.filter((reference) => reference.snapType === 'edge midpoint')
    expect(midpoint.point[0]).toBeCloseTo(10 * Math.cos(Math.PI / 4))
    expect(midpoint.point[1]).toBeCloseTo(10 * Math.sin(Math.PI / 4))
    expect(midpoint.edgeSegments).toHaveLength(16)
  })

  it('finds the centre of a hole', () => {
    const circle = arc(32, Math.PI * 2)
    const centres = edgeSnapReferences(circle, [{ start: 0, count: 64 }], feature).filter((reference) => reference.snapType === 'hole center')
    expect(centres).toHaveLength(1)
    expect(centres[0].radius).toBeCloseTo(10, 1)
  })

  it('treats every segment as an edge when there are no groups', () => {
    const references = edgeSnapReferences(square, undefined, feature)
    expect(references.filter((reference) => reference.snapType === 'edge midpoint')).toHaveLength(4)
  })
})

describe('pickEdgeChain', () => {
  // Looking straight down: screen x, y are model x, y.
  const project = (point: Vec3): [number, number] => [point[0], point[1]]

  it('picks the nearest edge within reach, the same either way round', () => {
    const picked = pickEdgeChain(square, squareGroups, [41, 12], project)!
    expect(picked.edge.start).toEqual([40, 0, 0])
    expect(picked.edge.end).toEqual([40, 20, 0])
    expect(picked.edge.point).toEqual([40, 10, 0])
    expect(picked.key).toBe('40.0000,0.0000,0.0000|40.0000,20.0000,0.0000')
  })

  it('picks the whole curved edge from any of its segments', () => {
    const quarter = arc(16, Math.PI / 2)
    const picked = pickEdgeChain(quarter, [{ start: 0, count: 32 }], [10.5, 0.5], project)!
    expect(picked.segments).toHaveLength(16)
    expect(picked.edge.start).toEqual(quarter[0].start)
    expect(picked.edge.end).toEqual(quarter[15].end)
  })

  it('picks nothing out of reach', () => {
    expect(pickEdgeChain(square, squareGroups, [20, 10], project, 5)).toBeNull()
    expect(pickEdgeChain([], undefined, [0, 0], project)).toBeNull()
  })
})
