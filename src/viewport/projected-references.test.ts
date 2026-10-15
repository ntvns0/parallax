import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../core/model'
import type { EdgeSegment } from './edge-references'
import { projectPartEdges } from './projected-references'

/** The twelve edges of a 50 × 30 × 8 plate from z = 0 to 8, one group per edge. */
function plate(): { segments: EdgeSegment[]; edgeGroups: { start: number; count: number }[] } {
  const corner = (x: number, y: number, z: number): Vec3 => [x, y, z]
  const ring = (z: number) => [corner(-25, -15, z), corner(25, -15, z), corner(25, 15, z), corner(-25, 15, z)]
  const bottom = ring(0)
  const top = ring(8)
  const segments: EdgeSegment[] = []
  for (const loop of [bottom, top]) loop.forEach((start, index) => segments.push({ start, end: loop[(index + 1) % 4] }))
  bottom.forEach((start, index) => segments.push({ start, end: top[index] }))
  return { segments, edgeGroups: segments.map((_, index) => ({ start: index * 2, count: 2 })) }
}

describe('projectPartEdges', () => {
  it('flattens a plate onto XY as its outline, each corner once', () => {
    const projected = projectPartEdges([plate()], 'XY')
    const corners = projected.points.filter((point) => point.kind === 'corner').map((point) => point.point)
    expect(corners).toHaveLength(4)
    expect(corners).toContainEqual([25, 15])
    // Top and bottom outlines both survive as edges; the uprights flatten to points and are dropped.
    expect(projected.edges).toHaveLength(8)
  })

  it('shows the plate from the side on XZ, with its thickness', () => {
    const projected = projectPartEdges([plate()], 'XZ')
    const corners = projected.points.filter((point) => point.kind === 'corner').map((point) => point.point)
    expect(corners).toContainEqual([25, 8])
    expect(corners).toContainEqual([-25, 0])
  })
})
