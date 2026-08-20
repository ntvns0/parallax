import type { SketchFaceAttachment, Vec2 } from './model'

export type FaceSnapKind = 'center' | 'corner' | 'midpoint' | 'edge'

export type FaceSnap = {
  point: Vec2
  kind: FaceSnapKind
  edgeIndex?: number
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

export function snapToFaceReference(point: Vec2, attachment: SketchFaceAttachment | undefined, tolerance: number): FaceSnap | null {
  if (!attachment || tolerance <= 0) return null
  const anchors: FaceSnap[] = [{ point: attachment.center, kind: 'center' }]
  attachment.edges.forEach((edge, edgeIndex) => {
    anchors.push({ point: edge.start, kind: 'corner', edgeIndex })
    anchors.push({ point: [(edge.start[0] + edge.end[0]) / 2, (edge.start[1] + edge.end[1]) / 2], kind: 'midpoint', edgeIndex })
  })
  let bestAnchor: FaceSnap | null = null
  let bestDistance = tolerance * tolerance
  for (const candidate of anchors) {
    const candidateDistance = distanceSquared(point, candidate.point)
    if (candidateDistance < bestDistance) {
      bestAnchor = candidate
      bestDistance = candidateDistance
    }
  }
  if (bestAnchor) return bestAnchor

  let bestEdge: FaceSnap | null = null
  bestDistance = tolerance * tolerance
  attachment.edges.forEach((edge, edgeIndex) => {
    const candidate: FaceSnap = { point: closestPointOnSegment(point, edge.start, edge.end), kind: 'edge', edgeIndex }
    const candidateDistance = distanceSquared(point, candidate.point)
    if (candidateDistance < bestDistance) {
      bestEdge = candidate
      bestDistance = candidateDistance
    }
  })
  return bestEdge
}
