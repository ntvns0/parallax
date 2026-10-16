import { SolveStatus, type GcsWrapper, type SketchPrimitive } from '@salusoft89/planegcs'
import { arcEndPoint, arcStartPoint, normalizeArc } from '../core/arc-geometry'
import type { ArcEntity, CircleEntity, LineEntity, SketchAnchor, SketchEntity } from '../core/model'
import type { ConstraintRequest, ConstraintResponse } from './constraint-types'
import { constraintPrimitive, pointId } from './constraint-primitives'

/**
 * One PlaneGCS solve, independent of where PlaneGCS was loaded.
 *
 * The worker loads the WebAssembly from a bundled URL and tests load it from
 * disk, and both hand the wrapper here, so a test of a solve is a test of the
 * solve the application runs.
 */

function isAnchored(anchor: SketchAnchor | undefined, entityId: string, point: 'start' | 'center') {
  return anchor?.entityId === entityId && anchor.point === point
}

const ARC_RULES_SUFFIX = ':arc-rules'
const arcRulesId = (arcId: string) => `${arcId}${ARC_RULES_SUFFIX}`
const isUserConstraint = (id: string) => !id.endsWith(ARC_RULES_SUFFIX)

export function solveWithPlaneGcs(wrapper: GcsWrapper, request: ConstraintRequest): Extract<ConstraintResponse, { ok: true }> {
  wrapper.clear_data()
  const primitives: SketchPrimitive[] = []
  // The document names the point to hold still, so solving the same sketch
  // twice gives the same answer regardless of entity order. Pinning it at the
  // coordinates that arrive in the request is also what lets a translation
  // survive a re-solve: move the anchor and the solution moves with it.
  const anchor = request.anchor
  let anchored = false

  for (const entity of request.entities) {
    if (entity.type === 'line') {
      const fixed = isAnchored(anchor, entity.id, 'start')
      primitives.push(
        { id: pointId(entity.id, 'start'), type: 'point', x: entity.start[0], y: entity.start[1], fixed },
        { id: pointId(entity.id, 'end'), type: 'point', x: entity.end[0], y: entity.end[1], fixed: false },
        { id: entity.id, type: 'line', p1_id: pointId(entity.id, 'start'), p2_id: pointId(entity.id, 'end') },
      )
      anchored = anchored || fixed
    } else if (entity.type === 'arc') {
      // PlaneGCS wants an arc's ends as their own points so they can be
      // constrained to neighbouring geometry, and keeps them consistent with
      // the angles as it solves.
      const fixed = isAnchored(anchor, entity.id, 'center')
      const start = arcStartPoint(entity)
      const end = arcEndPoint(entity)
      primitives.push(
        { id: pointId(entity.id, 'center'), type: 'point', x: entity.center[0], y: entity.center[1], fixed },
        { id: pointId(entity.id, 'start'), type: 'point', x: start[0], y: start[1], fixed: false },
        { id: pointId(entity.id, 'end'), type: 'point', x: end[0], y: end[1], fixed: false },
        {
          id: entity.id,
          type: 'arc',
          c_id: pointId(entity.id, 'center'),
          radius: entity.radius,
          start_id: pointId(entity.id, 'start'),
          end_id: pointId(entity.id, 'end'),
          start_angle: entity.startAngle,
          end_angle: entity.endAngle,
        },
        // Ties the end points to the centre, radius and angles. PlaneGCS does
        // not add this for an arc on its own — FreeCAD adds it for every arc —
        // and without it the end points follow their neighbours while the arc
        // keeps its old angles and comes apart from them.
        { id: arcRulesId(entity.id), type: 'arc_rules', a_id: entity.id },
      )
      anchored = anchored || fixed
    } else if (entity.type === 'point') {
      // Named as a centre, so every constraint that takes a centre takes a point.
      const fixed = isAnchored(anchor, entity.id, 'center')
      primitives.push({ id: pointId(entity.id, 'center'), type: 'point', x: entity.position[0], y: entity.position[1], fixed })
      anchored = anchored || fixed
    } else {
      const fixed = isAnchored(anchor, entity.id, 'center')
      primitives.push(
        { id: pointId(entity.id, 'center'), type: 'point', x: entity.center[0], y: entity.center[1], fixed },
        { id: entity.id, type: 'circle', c_id: pointId(entity.id, 'center'), radius: entity.radius },
      )
      anchored = anchored || fixed
    }
  }

  const entityById = new Map(request.entities.map((entity) => [entity.id, entity]))
  const unsupported: string[] = []
  for (const constraint of request.constraints) {
    const primitive = constraintPrimitive(constraint, entityById)
    if (primitive) primitives.push(primitive)
    else unsupported.push(constraint.id)
  }

  wrapper.push_primitives_and_params(primitives)
  const status = wrapper.solve()
  wrapper.apply_solution()
  const solved = wrapper.sketch_index.get_primitives()
  const solvedMap = new Map(solved.map((primitive) => [primitive.id, primitive]))
  const entities: SketchEntity[] = request.entities.map((entity): SketchEntity => {
    if (entity.type === 'line') {
      const start = solvedMap.get(pointId(entity.id, 'start'))
      const end = solvedMap.get(pointId(entity.id, 'end'))
      if (start?.type !== 'point' || end?.type !== 'point') return entity
      return { ...entity, start: [start.x, start.y], end: [end.x, end.y] } satisfies LineEntity
    }
    if (entity.type === 'arc') {
      const center = solvedMap.get(pointId(entity.id, 'center'))
      const arc = solvedMap.get(entity.id)
      if (center?.type !== 'point' || arc?.type !== 'arc') return entity
      // The solver is free to hand back angles in any order or winding, so
      // put the result back into the counter-clockwise form the document and
      // every consumer of it expect.
      const solvedArc = normalizeArc([center.x, center.y], arc.radius, arc.start_angle, arc.end_angle)
      return {
        ...entity,
        center: solvedArc.center,
        radius: solvedArc.radius,
        startAngle: solvedArc.startAngle,
        endAngle: solvedArc.endAngle,
      } satisfies ArcEntity
    }
    if (entity.type === 'point') {
      const position = solvedMap.get(pointId(entity.id, 'center'))
      return position?.type === 'point' ? { ...entity, position: [position.x, position.y] } : entity
    }
    const center = solvedMap.get(pointId(entity.id, 'center'))
    const circle = solvedMap.get(entity.id)
    if (center?.type !== 'point' || circle?.type !== 'circle') return entity
    return { ...entity, center: [center.x, center.y], radius: circle.radius } satisfies CircleEntity
  })
  const response: Extract<ConstraintResponse, { ok: true }> = {
    id: request.id,
    ok: true,
    entities,
    converged: status === SolveStatus.Success || status === SolveStatus.Converged,
    // Only the user's constraints are named; the arc rules added above are
    // part of what an arc is, not something the user can edit or remove.
    redundant: wrapper.get_gcs_redundant_constraints().filter(isUserConstraint),
    conflicting: wrapper.get_gcs_conflicting_constraints().filter(isUserConstraint),
    // Constraints the solver was never given, because nothing in PlaneGCS
    // expresses them against the geometry they name. Reported rather than
    // dropped: a constraint that is listed in the sketch but is not holding
    // anything is otherwise invisible.
    unsupported,
    // The anchor is a solver datum, not a user-authored constraint, so add
    // its two translational freedoms back before reporting. The sketch really
    // can still be repositioned.
    degreesOfFreedom: wrapper.gcs.dof() + (anchored ? 2 : 0),
  }
  return response
}
