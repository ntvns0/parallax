import { arcFromCenterAndPoints, arcFromThreePoints, tangentArcFromEndpoint } from '../core/arc-geometry'
import type { FaceSnap } from '../core/face-reference'
import { createId, type ArcEntity, type LineEntity, type SketchConstraint, type SketchEntity, type Vec2 } from '../core/model'
import type { SketchEntitySnap } from './entity-snap'
import type { TangentArcSource } from './tangent-arc'

/**
 * What each drawing tool adds to a sketch: its entities, and the constraints
 * that record the intent the gesture expressed — a rectangle's square corners,
 * a line that started on another line's midpoint, a tangent arc's tangency.
 *
 * Pure, so a tool's meaning can be tested without a pointer, and so the same
 * meaning survives any change to the surface it is drawn on.
 */

export type GeometryAddition = { entities: SketchEntity[]; constraints: SketchConstraint[] }

/** A snap the pointer acquired, from sketch geometry or the attached face. */
export type ActiveSnap = ({ source: 'entity' } & SketchEntitySnap) | ({ source: 'face' } & FaceSnap)

export function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/** Corner to corner, with each side held horizontal or vertical and both sizes dimensioned. */
export function rectangleGeometry(start: Vec2, end: Vec2): GeometryAddition {
  const corners: Vec2[] = [start, [end[0], start[1]], end, [start[0], end[1]]]
  const entities: LineEntity[] = corners.map((corner, index) => ({
    id: createId(), type: 'line', start: corner, end: corners[(index + 1) % 4], construction: false,
  }))
  const constraints: SketchConstraint[] = entities.map((line, index) => ({
    id: createId(), type: index % 2 === 0 ? 'horizontal' : 'vertical', entityIds: [line.id],
  }))
  constraints.push({ id: createId(), type: 'distance', entityIds: [entities[0].id], value: Math.abs(end[0] - start[0]) })
  constraints.push({ id: createId(), type: 'distance', entityIds: [entities[1].id], value: Math.abs(end[1] - start[1]) })
  for (let index = 0; index < 4; index += 1) {
    constraints.push({
      id: createId(),
      type: 'coincident',
      entityIds: [entities[index].id, entities[(index + 1) % 4].id],
      pointRefs: ['end', 'start'],
    })
  }
  return { entities, constraints }
}

/** A circle from its centre and a point on it, with its radius dimensioned. */
export function circleGeometry(center: Vec2, through: Vec2): GeometryAddition {
  const radius = distance(center, through)
  const entity = { id: createId(), type: 'circle' as const, center, radius, construction: false }
  return { entities: [entity], constraints: [{ id: createId(), type: 'radius', entityIds: [entity.id], value: radius }] }
}

/**
 * The constraints that make a snapped line end mean what the snap meant: on an
 * endpoint, coincident; on a midpoint, the midpoint; on a ruler division, on
 * the line at that distance; on a line, on the line.
 */
export function snapConstraints(entityId: string, pointRef: 'start' | 'end', target: ActiveSnap | null): SketchConstraint[] {
  if (!target || target.source !== 'entity') return []
  if (target.kind === 'endpoint' && target.pointRef) {
    return [{ id: createId(), type: 'coincident', entityIds: [entityId, target.entityIds[0]], pointRefs: [pointRef, target.pointRef] }]
  }
  if (target.kind === 'midpoint') {
    return [{ id: createId(), type: 'midpoint', entityIds: [entityId, target.entityIds[0]], pointRefs: [pointRef] }]
  }
  if (target.kind === 'division' && target.pointRef && target.distance !== undefined) {
    return [
      { id: createId(), type: 'pointOnLine', entityIds: [entityId, target.entityIds[0]], pointRefs: [pointRef] },
      {
        id: createId(),
        type: 'pointDistance',
        entityIds: [entityId, target.entityIds[0]],
        pointRefs: [pointRef, target.pointRef],
        value: target.distance,
      },
    ]
  }
  return target.entityIds.map((targetId) => ({
    id: createId(), type: 'pointOnLine' as const, entityIds: [entityId, targetId], pointRefs: [pointRef],
  }))
}

/**
 * A line, held horizontal, vertical, or at the angle it was inferred to have,
 * with its ends tied to whatever they snapped to.
 */
export function lineGeometry(
  start: Vec2,
  end: Vec2,
  inferredAngle: number | null,
  startSnap: ActiveSnap | null,
  endSnap: ActiveSnap | null,
): GeometryAddition {
  const entity: LineEntity = { id: createId(), type: 'line', start, end, construction: false }
  const constraints: SketchConstraint[] = []
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  if (Math.abs(dy) < 1e-8) constraints.push({ id: createId(), type: 'horizontal', entityIds: [entity.id] })
  else if (Math.abs(dx) < 1e-8) constraints.push({ id: createId(), type: 'vertical', entityIds: [entity.id] })
  else if (inferredAngle !== null) constraints.push({ id: createId(), type: 'angle', entityIds: [entity.id], value: inferredAngle })
  constraints.push(...snapConstraints(entity.id, 'start', startSnap), ...snapConstraints(entity.id, 'end', endSnap))
  return { entities: [entity], constraints }
}

function radiusDimensioned(arc: Pick<ArcEntity, 'center' | 'radius' | 'startAngle' | 'endAngle'>): GeometryAddition {
  const entity: ArcEntity = {
    id: createId(), type: 'arc', center: arc.center, radius: arc.radius,
    startAngle: arc.startAngle, endAngle: arc.endAngle, construction: false,
  }
  return { entities: [entity], constraints: [{ id: createId(), type: 'radius', entityIds: [entity.id], value: arc.radius }] }
}

/**
 * A centre-point arc. The first two clicks fix the centre and the radius; the
 * last only says how far round to sweep, so a stray final click cannot distort
 * the arc.
 */
export function centrePointArcGeometry(center: Vec2, start: Vec2, sweepTo: Vec2): GeometryAddition | null {
  const arc = arcFromCenterAndPoints(center, start, sweepTo)
  return arc && radiusDimensioned(arc)
}

export function threePointArcGeometry(start: Vec2, end: Vec2, through: Vec2): GeometryAddition | null {
  const arc = arcFromThreePoints(start, end, through)
  return arc && radiusDimensioned(arc)
}

/** An arc leaving an existing endpoint along its tangent, joined and tangent to it. */
export function tangentArcGeometry(source: TangentArcSource, end: Vec2): GeometryAddition | null {
  const arc = tangentArcFromEndpoint(source.point, end, source.tangent)
  if (!arc) return null
  const entity: ArcEntity = {
    id: createId(), type: 'arc', center: arc.center, radius: arc.radius,
    startAngle: arc.startAngle, endAngle: arc.endAngle, construction: false,
  }
  return {
    entities: [entity],
    constraints: [
      { id: createId(), type: 'coincident', entityIds: [source.entityId, entity.id], pointRefs: [source.pointRef, arc.joinRef] },
      { id: createId(), type: 'tangent', entityIds: [source.entityId, entity.id] },
      { id: createId(), type: 'radius', entityIds: [entity.id], value: arc.radius },
    ],
  }
}
