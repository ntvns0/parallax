import type { SketchFaceAttachment, Vec2 } from './model'

/**
 * Snapping a sketch point to geometry that is not part of the sketch: the face
 * a sketch is attached to, or the part's edges projected onto the sketch
 * plane. Discrete points win over the nearest point along an edge, the way a
 * corner beats the line it ends.
 */

export type FaceSnapKind = 'center' | 'corner' | 'midpoint' | 'edge'

export type FaceSnap = {
  point: Vec2
  kind: FaceSnapKind
  edgeIndex?: number
}

/** Geometry to snap to, in sketch coordinates. */
export type ReferenceGeometry = {
  points: { point: Vec2; kind: Exclude<FaceSnapKind, 'edge'> }[]
  edges: { start: Vec2; end: Vec2 }[]
}

function distanceSquared(a: Vec2, b: Vec2) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function closestPointOnSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-12) return start
  const position = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
  return [start[0] + dx * position, start[1] + dy * position]
}

export function snapToReferenceGeometry(point: Vec2, reference: ReferenceGeometry | null | undefined, tolerance: number): FaceSnap | null {
  if (!reference || tolerance <= 0) return null
  let best: FaceSnap | null = null
  let bestDistance = tolerance * tolerance
  for (const candidate of reference.points) {
    const candidateDistance = distanceSquared(point, candidate.point)
    if (candidateDistance < bestDistance) {
      best = { point: candidate.point, kind: candidate.kind }
      bestDistance = candidateDistance
    }
  }
  if (best) return best

  reference.edges.forEach((edge, edgeIndex) => {
    const candidate: FaceSnap = { point: closestPointOnSegment(point, edge.start, edge.end), kind: 'edge', edgeIndex }
    const candidateDistance = distanceSquared(point, candidate.point)
    if (candidateDistance < bestDistance) {
      best = candidate
      bestDistance = candidateDistance
    }
  })
  return best
}

/** The attached face's centre, corners, edge midpoints, and edges. */
export function snapToFaceReference(point: Vec2, attachment: SketchFaceAttachment | undefined, tolerance: number): FaceSnap | null {
  if (!attachment) return null
  const points: ReferenceGeometry['points'] = [{ point: attachment.center, kind: 'center' }]
  for (const edge of attachment.edges) {
    points.push({ point: edge.start, kind: 'corner' })
    points.push({ point: [(edge.start[0] + edge.end[0]) / 2, (edge.start[1] + edge.end[1]) / 2], kind: 'midpoint' })
  }
  const snap = snapToReferenceGeometry(point, { points, edges: attachment.edges }, tolerance)
  if (!snap || snap.kind === 'edge') return snap
  // Corners and midpoints keep naming the edge they came from.
  const index = points.findIndex((candidate) => candidate.point === snap.point && candidate.kind === snap.kind)
  return index > 0 ? { ...snap, edgeIndex: Math.floor((index - 1) / 2) } : snap
}
