import { describe, expect, it } from 'vitest'
import { ExactEdgeIndex } from './exact-edge-index'
import type { KernelMesh } from '../kernel/kernel-types'

describe('ExactEdgeIndex', () => {
  it('handles null/empty mesh', () => {
    const index = new ExactEdgeIndex(null)
    expect(index.count).toBe(0)
    expect(index.findClosestEdge([0, 0, 0])).toBeNull()
  })

  it('indexes edges from a mesh with edgeLines and finds closest edge', () => {
    const edgeLines = [
      0, 0, 0, 10, 0, 0,
      10, 0, 0, 10, 10, 0,
      10, 10, 0, 0, 10, 0,
      0, 10, 0, 0, 0, 0,

      0, 0, 10, 10, 0, 10,
      10, 0, 10, 10, 10, 10,
      10, 10, 10, 0, 10, 10,
      0, 10, 10, 0, 0, 10,

      0, 0, 0, 0, 0, 10,
      10, 0, 0, 10, 0, 10,
      10, 10, 0, 10, 10, 10,
      0, 10, 0, 0, 10, 10,
    ]

    const mockMesh: KernelMesh = {
      vertices: [],
      normals: [],
      triangles: [],
      edgeLines,
      faceGroups: [],
      edgeGroups: [],
      unresolved: [],
    }

    const index = new ExactEdgeIndex(mockMesh)
    expect(index.count).toBe(12)

    const match = index.findClosestEdge([5, 0.1, 0])
    expect(match).not.toBeNull()
    if (match) {
      expect(match.distance).toBeLessThan(0.2)
      expect(match.edge.start).toEqual([0, 0, 0])
      expect(match.edge.end).toEqual([10, 0, 0])
    }
  })
})
