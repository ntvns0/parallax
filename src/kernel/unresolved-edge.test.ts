import { describe, expect, it } from 'vitest'
import type { FilletEdgeReference } from '../core/model'
import { describeUnresolvedEdge, nearestMovedEdge, type EdgeGeometry } from './unresolved-edge'

/** A straight edge along X at a given offset, as the kernel reports one. */
function edgeAt(y: number, z: number, x0 = 0, x1 = 10): EdgeGeometry {
  return { start: [x0, y, z], end: [x1, y, z], middle: [(x0 + x1) / 2, y, z] }
}

const reference: FilletEdgeReference = { start: [0, 0, 0], end: [10, 0, 0], point: [5, 0, 0] }

describe('nearestMovedEdge', () => {
  it('finds the same edge after the sketch that made it moved', () => {
    const moved = nearestMovedEdge(reference, [edgeAt(0, 0, 5, 15)])

    expect(moved?.drift).toBeCloseTo(5)
  })

  it('prefers the closest candidate when several are parallel', () => {
    const moved = nearestMovedEdge(reference, [edgeAt(0, 0, 20, 30), edgeAt(0, 0, 3, 13)])

    expect(moved?.drift).toBeCloseTo(3)
  })

  it('ignores edges pointing a different way', () => {
    const perpendicular: EdgeGeometry = { start: [5, 0, 0], end: [5, 10, 0], middle: [5, 5, 0] }

    expect(nearestMovedEdge(reference, [perpendicular])).toBeNull()
  })

  it('ignores an edge of a very different length', () => {
    // A short collinear stub is not the 10mm edge that was selected.
    expect(nearestMovedEdge(reference, [edgeAt(0, 0, 5, 6)])).toBeNull()
  })

  it('gives up rather than blaming an edge on the far side of the part', () => {
    expect(nearestMovedEdge(reference, [edgeAt(0, 400)])).toBeNull()
  })

  it('reports nothing when the solid has no edges left to match', () => {
    expect(nearestMovedEdge(reference, [])).toBeNull()
  })
})

describe('describeUnresolvedEdge', () => {
  it('says the geometry moved, and by how much, when it can find it', () => {
    const message = describeUnresolvedEdge('Fillet 1', reference, [edgeAt(0, 0, 5, 15)])

    expect(message).toContain('Fillet 1')
    expect(message).toContain('5.0 mm')
    expect(message).toContain('moved')
  })

  it('says the edge is gone when nothing resembles it', () => {
    const message = describeUnresolvedEdge('Fillet 1', reference, [])

    expect(message).toContain('no longer exists')
    // The old message always blamed an earlier fillet; it must not claim that
    // as the cause when it does not know.
    expect(message).not.toMatch(/is already a smooth boundary/)
  })
})
