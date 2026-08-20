import type { Vec3, FilletEdgeReference } from '../core/model'
import { extractMeshEdges, type EdgeGeometry, matchesFilletSourceEdge } from '../kernel/fillet-edge-reference'
import type { KernelMesh } from '../kernel/kernel-types'

export interface IndexedEdge {
  id: number
  start: Vec3
  end: Vec3
  middle: Vec3
  length: number
}

function squaredDistance(a: readonly number[], b: readonly number[]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function distanceToSegmentSquared(point: Vec3, start: Vec3, end: Vec3): { distanceSq: number; closest: Vec3; t: number } {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const lenSq = dx * dx + dy * dy + dz * dz

  if (lenSq < 1e-12) {
    return { distanceSq: squaredDistance(point, start), closest: [...start], t: 0 }
  }

  const t = Math.max(0, Math.min(1, (
    (point[0] - start[0]) * dx +
    (point[1] - start[1]) * dy +
    (point[2] - start[2]) * dz
  ) / lenSq))

  const closest: Vec3 = [
    start[0] + t * dx,
    start[1] + t * dy,
    start[2] + t * dz,
  ]

  return { distanceSq: squaredDistance(point, closest), closest, t }
}

export class ExactEdgeIndex {
  private readonly edges: IndexedEdge[] = []

  constructor(mesh?: KernelMesh | null) {
    if (mesh) {
      const extracted = extractMeshEdges(mesh)
      this.edges = extracted.map((e, index) => {
        const dx = e.end[0] - e.start[0]
        const dy = e.end[1] - e.start[1]
        const dz = e.end[2] - e.start[2]
        return {
          id: index,
          start: [...e.start] as Vec3,
          end: [...e.end] as Vec3,
          middle: [...e.middle] as Vec3,
          length: Math.hypot(dx, dy, dz),
        }
      })
    }
  }

  get count(): number {
    return this.edges.length
  }

  getIndexedEdges(): readonly IndexedEdge[] {
    return this.edges
  }

  toEdgeGeometries(): EdgeGeometry[] {
    return this.edges.map((e) => ({
      start: e.start,
      end: e.end,
      middle: e.middle,
    }))
  }

  findClosestEdge(point: Vec3, maxDistance = Infinity): { edge: IndexedEdge; closestPoint: Vec3; distance: number; t: number } | null {
    let best: { edge: IndexedEdge; closestPoint: Vec3; distance: number; t: number } | null = null
    let minSq = maxDistance * maxDistance

    for (const edge of this.edges) {
      const { distanceSq, closest, t } = distanceToSegmentSquared(point, edge.start, edge.end)
      if (distanceSq < minSq) {
        minSq = distanceSq
        best = {
          edge,
          closestPoint: closest,
          distance: Math.sqrt(distanceSq),
          t,
        }
      }
    }

    return best
  }

  findReferenceMatch(ref: FilletEdgeReference): IndexedEdge | null {
    for (const edge of this.edges) {
      if (matchesFilletSourceEdge(edge, ref)) {
        return edge
      }
    }
    return null
  }
}
