import { arcEndPoint, arcStartPoint } from '../core/arc-geometry'
import type { SketchEntity, SketchPointRef, Vec2 } from '../core/model'

export type TangentArcSource = {
  entityId: string
  pointRef: SketchPointRef
  point: Vec2
  /** Direction in which a new curve leaves the selected endpoint. */
  tangent: Vec2
}

/** Resolve a click near a line or arc endpoint into its outward tangent. */
export function tangentSourceAtPoint(entity: SketchEntity, point: Vec2, tolerance: number): TangentArcSource | null {
  const candidates: TangentArcSource[] = []
  if (entity.type === 'line') {
    candidates.push(
      { entityId: entity.id, pointRef: 'start', point: entity.start, tangent: [entity.start[0] - entity.end[0], entity.start[1] - entity.end[1]] },
      { entityId: entity.id, pointRef: 'end', point: entity.end, tangent: [entity.end[0] - entity.start[0], entity.end[1] - entity.start[1]] },
    )
  } else if (entity.type === 'arc') {
    const start = arcStartPoint(entity)
    const end = arcEndPoint(entity)
    candidates.push(
      { entityId: entity.id, pointRef: 'start', point: start, tangent: [Math.sin(entity.startAngle), -Math.cos(entity.startAngle)] },
      { entityId: entity.id, pointRef: 'end', point: end, tangent: [-Math.sin(entity.endAngle), Math.cos(entity.endAngle)] },
    )
  }
  return candidates
    .map((candidate) => ({ candidate, distance: Math.hypot(point[0] - candidate.point[0], point[1] - candidate.point[1]) }))
    .filter(({ distance }) => distance <= tolerance)
    .sort((left, right) => left.distance - right.distance)[0]?.candidate ?? null
}
