/// <reference lib="webworker" />

import { GcsWrapper, init_planegcs_module, type SketchPrimitive } from '@salusoft89/planegcs'
import planeGcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'
import { arcEndPoint, arcStartPoint, normalizeArc } from '../core/arc-geometry'
import type { ArcEntity, CircleEntity, LineEntity, SketchAnchor, SketchEntity } from '../core/model'
import type { ConstraintRequest, ConstraintResponse } from './constraint-types'
import { constraintPrimitive, pointId } from './constraint-primitives'

let wrapperPromise: Promise<GcsWrapper> | null = null

function getWrapper() {
  if (!wrapperPromise) {
    wrapperPromise = (async () => {
      const module = await init_planegcs_module({ locateFile: () => planeGcsWasm })
      return new GcsWrapper(new module.GcsSystem(), module)
    })()
  }
  return wrapperPromise
}

function isAnchored(anchor: SketchAnchor | undefined, entityId: string, point: 'start' | 'center') {
  return anchor?.entityId === entityId && anchor.point === point
}

self.onmessage = async (event: MessageEvent<ConstraintRequest>) => {
  const request = event.data
  try {
    const wrapper = await getWrapper()
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
        )
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
    wrapper.solve()
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
      const center = solvedMap.get(pointId(entity.id, 'center'))
      const circle = solvedMap.get(entity.id)
      if (center?.type !== 'point' || circle?.type !== 'circle') return entity
      return { ...entity, center: [center.x, center.y], radius: circle.radius } satisfies CircleEntity
    })
    const response: ConstraintResponse = {
      id: request.id,
      ok: true,
      entities,
      redundant: wrapper.get_gcs_redundant_constraints(),
      conflicting: wrapper.get_gcs_conflicting_constraints(),
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
    self.postMessage(response)
  } catch (error) {
    const response: ConstraintResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
