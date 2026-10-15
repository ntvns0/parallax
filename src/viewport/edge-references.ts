import * as THREE from 'three'
import { findCircularLoopCenters, type MeasurementReference } from '../core/measurement'
import type { FeatureKind, FilletEdgeReference, Vec3 } from '../core/model'

/**
 * What can be pointed at along a solid's edges.
 *
 * Edges arrive as a flat list of segments, two vertices each, with the
 * kernel's edge groups saying which runs of vertices make up one topological
 * edge: a straight edge is one segment, a curved one many. Groups count
 * vertices, not segments, which is why indices here are halved and doubled.
 */

export type EdgeSegment = { start: Vec3; end: Vec3 }
export type EdgeGroup = { start: number; count: number }

/** The segments of an edge position attribute, moved into world space. */
export function worldEdgeSegments(positions: THREE.BufferAttribute, matrix: THREE.Matrix4): EdgeSegment[] {
  const segments: EdgeSegment[] = []
  for (let index = 0; index + 1 < positions.count; index += 2) {
    segments.push({
      start: new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(matrix).toArray() as Vec3,
      end: new THREE.Vector3().fromBufferAttribute(positions, index + 1).applyMatrix4(matrix).toArray() as Vec3,
    })
  }
  return segments
}

/** Vertex `index` of the flat vertex list the segments came from. */
function vertexAt(segments: EdgeSegment[], index: number): Vec3 {
  const segment = segments[Math.floor(index / 2)]
  return index % 2 === 0 ? segment.start : segment.end
}

const length = (segment: EdgeSegment) => Math.hypot(
  segment.end[0] - segment.start[0],
  segment.end[1] - segment.start[1],
  segment.end[2] - segment.start[2],
)

const pointKey = (point: Vec3) => point.map((value) => value.toFixed(4)).join(',')

/** Halfway along a chain of segments, measured along the chain. */
export function polylineMidpoint(segments: EdgeSegment[]): Vec3 {
  let remaining = segments.reduce((sum, segment) => sum + length(segment), 0) / 2
  for (const segment of segments) {
    const span = length(segment)
    if (remaining <= span || segment === segments.at(-1)) {
      const ratio = span < 1e-9 ? 0 : remaining / span
      return [
        segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
        segment.start[1] + (segment.end[1] - segment.start[1]) * ratio,
        segment.start[2] + (segment.end[2] - segment.start[2]) * ratio,
      ]
    }
    remaining -= span
  }
  return segments[0].start
}

/** Groups that describe a real edge: in range, and not a closed loop with no ends. */
function usableGroups(segments: EdgeSegment[], edgeGroups: EdgeGroup[]) {
  const vertexCount = segments.length * 2
  return edgeGroups.filter((group) => {
    if (group.count < 2 || group.start < 0 || group.start + group.count > vertexCount) return false
    const start = vertexAt(segments, group.start)
    const end = vertexAt(segments, group.start + group.count - 1)
    return Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]) >= 0.001
  })
}

/**
 * Every discrete measuring target on a solid's edges: the centre of each
 * circular loop, each edge's end vertices, and each edge's midpoint. Without
 * edge groups, every segment is treated as an edge of its own.
 */
export function edgeSnapReferences(
  segments: EdgeSegment[],
  edgeGroups: EdgeGroup[] | undefined,
  feature: { id: string; name: string; kind: FeatureKind },
): MeasurementReference[] {
  const owner = { featureId: feature.id, featureName: feature.name, featureKind: feature.kind }
  const references: MeasurementReference[] = findCircularLoopCenters(segments).map((loop) => ({
    ...owner, point: loop.center, snapType: 'hole center', radius: loop.radius,
  }))
  const seen = new Set<string>()
  const addOnce = (reference: MeasurementReference) => {
    const key = `${reference.snapType}:${pointKey(reference.point)}`
    if (seen.has(key)) return
    seen.add(key)
    references.push(reference)
  }
  const addEdge = (start: Vec3, end: Vec3, edgeSegments: EdgeSegment[]) => {
    addOnce({ ...owner, point: start, snapType: 'vertex' })
    addOnce({ ...owner, point: end, snapType: 'vertex' })
    addOnce({ ...owner, point: polylineMidpoint(edgeSegments), snapType: 'edge midpoint', edgeSegments })
  }
  if (edgeGroups?.length) {
    for (const group of usableGroups(segments, edgeGroups)) {
      addEdge(
        vertexAt(segments, group.start),
        vertexAt(segments, group.start + group.count - 1),
        segments.slice(group.start / 2, (group.start + group.count) / 2),
      )
    }
  } else {
    for (const segment of segments) addEdge(segment.start, segment.end, [segment])
  }
  return references
}

type ScreenPoint = [number, number]

/** Distance on screen from `cursor` to a projected segment. */
function screenDistance(cursor: ScreenPoint, start: ScreenPoint, end: ScreenPoint) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  const fraction = lengthSquared < 1e-9
    ? 0
    : Math.min(1, Math.max(0, ((cursor[0] - start[0]) * dx + (cursor[1] - start[1]) * dy) / lengthSquared))
  return Math.hypot(start[0] + dx * fraction - cursor[0], start[1] + dy * fraction - cursor[1])
}

/**
 * The whole edge nearest the cursor on screen, as a fillet references it, or
 * null when no edge is within `tolerancePx`. `key` is the same for either
 * direction along the edge, so picking it twice can be recognised.
 */
export function pickEdgeChain(
  segments: EdgeSegment[],
  edgeGroups: EdgeGroup[] | undefined,
  cursor: ScreenPoint,
  project: (point: Vec3) => ScreenPoint,
  tolerancePx = 20,
): { edge: FilletEdgeReference; segments: EdgeSegment[]; key: string } | null {
  let closest: { vertex: number; distance: number } | null = null
  segments.forEach((segment, index) => {
    const distance = screenDistance(cursor, project(segment.start), project(segment.end))
    if (!closest || distance < closest.distance) closest = { vertex: index * 2, distance }
  })
  const nearest = closest as { vertex: number; distance: number } | null
  if (!nearest || nearest.distance > tolerancePx) return null
  const group = edgeGroups?.find((candidate) => nearest.vertex >= candidate.start && nearest.vertex < candidate.start + candidate.count)
  const first = group?.start ?? nearest.vertex
  const last = group ? group.start + group.count - 1 : nearest.vertex + 1
  const chain: EdgeSegment[] = []
  for (let index = first; index + 1 <= last; index += 2) {
    chain.push({ start: vertexAt(segments, index), end: vertexAt(segments, index + 1) })
  }
  const start = vertexAt(segments, first)
  const end = vertexAt(segments, last)
  return {
    edge: { point: polylineMidpoint(chain), start, end },
    segments: chain,
    key: [start, end].map(pointKey).sort().join('|'),
  }
}
