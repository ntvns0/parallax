import type { ReferenceGeometry } from '../core/face-reference'
import type { SketchPlane, Vec2 } from '../core/model'
import { edgeSnapTargets, type EdgeGroup, type EdgeSegment } from './edge-references'
import { projectToSketchPlane } from './face-classification'

const KIND = { vertex: 'corner', 'edge midpoint': 'midpoint', 'hole center': 'center' } as const

/**
 * The part's edges flattened onto a sketch plane, as geometry a sketch can
 * snap to: every corner, edge midpoint and hole centre, and every edge.
 *
 * Projection drops the coordinate along the plane's normal, so a hole through
 * a plate offers its centre on a sketch on any parallel plane, and a wall's
 * edges line up with a sketch drawn beside it. An edge running along the
 * normal flattens to a point; its ends are already corners, so it adds no
 * edge.
 */
export function projectPartEdges(parts: { segments: EdgeSegment[]; edgeGroups?: EdgeGroup[] }[], plane: SketchPlane): ReferenceGeometry {
  const points: ReferenceGeometry['points'] = []
  const edges: ReferenceGeometry['edges'] = []
  const seen = new Set<string>()
  const key = (point: Vec2) => `${point[0].toFixed(4)},${point[1].toFixed(4)}`
  for (const part of parts) {
    for (const target of edgeSnapTargets(part.segments, part.edgeGroups)) {
      const point = projectToSketchPlane(plane, target.point)
      const kind = KIND[target.snapType]
      // A box's top and bottom corners flatten onto the same point.
      if (seen.has(`${kind}:${key(point)}`)) continue
      seen.add(`${kind}:${key(point)}`)
      points.push({ point, kind })
    }
    for (const segment of part.segments) {
      const start = projectToSketchPlane(plane, segment.start)
      const end = projectToSketchPlane(plane, segment.end)
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) > 1e-6) edges.push({ start, end })
    }
  }
  return { points, edges }
}
