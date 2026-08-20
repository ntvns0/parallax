import { describe, expect, it } from 'vitest'
import {
  compareMeasurementSnapCandidates,
  findCircularLoopCenters,
  measurementEdgeAngle,
  measurementLineOrientation,
  measurementRelativeEdgeAngles,
  measurementValues,
} from './measurement'

describe('measurement values', () => {
  it('reports signed axis deltas and total distance', () => {
    expect(measurementValues([1, 2, 3], [4, 6, 15])).toEqual({
      delta: [3, 4, 12],
      distance: 13,
    })
  })

  it('finds the center and radius of a closed circular edge loop', () => {
    const points = Array.from({ length: 24 }, (_, index) => {
      const angle = index / 24 * Math.PI * 2
      return [10 + Math.cos(angle) * 4, -3 + Math.sin(angle) * 4, 8] as [number, number, number]
    })
    const loops = findCircularLoopCenters(points.map((start, index) => ({ start, end: points[(index + 1) % points.length] })))

    expect(loops).toHaveLength(1)
    expect(loops[0].center[0]).toBeCloseTo(10)
    expect(loops[0].center[1]).toBeCloseTo(-3)
    expect(loops[0].center[2]).toBeCloseTo(8)
    expect(loops[0].radius).toBeCloseTo(4)
  })

  it('does not misidentify a rectangular loop as circular', () => {
    const points: [number, number, number][] = [[-5, -5, 0], [0, -5, 0], [5, -5, 0], [5, 0, 0], [5, 5, 0], [0, 5, 0], [-5, 5, 0], [-5, 0, 0]]
    expect(findCircularLoopCenters(points.map((start, index) => ({ start, end: points[(index + 1) % points.length] })))).toEqual([])
  })

  it('acquires corners and midpoints ahead of a closer edge projection', () => {
    const candidates = [
      { snapType: 'edge' as const, distance: 0 },
      { snapType: 'edge midpoint' as const, distance: 12 },
      { snapType: 'vertex' as const, distance: 17 },
    ].sort(compareMeasurementSnapCandidates)

    expect(candidates.map((candidate) => candidate.snapType)).toEqual(['vertex', 'edge midpoint', 'edge'])
  })

  it('measures the included angle between snapped straight edges', () => {
    const reference = (end: [number, number, number]) => ({
      point: [0, 0, 0] as [number, number, number],
      featureId: 'box',
      featureName: 'Box',
      featureKind: 'box' as const,
      snapType: 'edge midpoint' as const,
      edgeSegments: [{ start: [0, 0, 0] as [number, number, number], end }],
    })

    expect(measurementEdgeAngle(reference([10, 0, 0]), reference([10, 10, 0]))).toBeCloseTo(45)
    expect(measurementEdgeAngle(reference([10, 0, 0]), reference([0, 10, 0]))).toBeCloseTo(90)
  })

  it('separates absolute line bearing from its relative edge angles', () => {
    const edge = {
      point: [0, 0, 0] as [number, number, number],
      featureId: 'cabinet', featureName: 'Cabinet', featureKind: 'extrude' as const, snapType: 'edge midpoint' as const,
      edgeSegments: [{ start: [0, -10, 0] as [number, number, number], end: [0, 10, 0] as [number, number, number] }],
    }
    const start: [number, number, number] = [-215.9, 0, 15.875]
    const end: [number, number, number] = [164.5366, 292.1, 15.875]

    const orientation = measurementLineOrientation(start, end)
    const relative = measurementRelativeEdgeAngles(edge, start, end)
    expect(orientation).toMatchObject({ kind: 'planar', plane: 'XY' })
    expect(orientation?.kind === 'planar' ? orientation.bearing : null).toBeCloseTo(37.52, 2)
    expect(relative?.smaller).toBeCloseTo(52.48, 2)
    expect(relative?.supplementary).toBeCloseTo(127.52, 2)
  })
})
