import type { SketchPrimitive } from '@salusoft89/planegcs'
import type { SketchConstraint, SketchEntity, SketchPointRef } from '../core/model'

/**
 * Translating Parallax constraints into PlaneGCS primitives.
 *
 * Kept out of the worker so it can be tested without WebAssembly. That matters
 * more here than usual: PlaneGCS names a different constraint for each
 * combination of entity kinds — `tangent_lc`, `tangent_la`, `arc_radius`
 * against `circle_radius` — and picking the wrong one is not an error, it is a
 * constraint that quietly fails to hold.
 *
 * Anything that cannot be expressed returns null rather than throwing, and the
 * caller reports it. A constraint the solver never received is the one failure
 * mode a user cannot diagnose from the sketch.
 */

export function pointId(entityId: string, point: SketchPointRef) {
  return `${entityId}:${point}`
}

/** A round entity: one PlaneGCS models with a centre and a radius. */
function isRound(entity: SketchEntity): entity is Extract<SketchEntity, { type: 'circle' | 'arc' }> {
  return entity.type === 'circle' || entity.type === 'arc'
}

function tangentPrimitive(id: string, first: SketchEntity, second: SketchEntity): SketchPrimitive | null {
  const line = first.type === 'line' ? first : second.type === 'line' ? second : null
  const round = first.type === 'line' ? second : first
  if (line) {
    if (round.type === 'circle') return { id, type: 'tangent_lc', l_id: line.id, c_id: round.id }
    if (round.type === 'arc') return { id, type: 'tangent_la', l_id: line.id, a_id: round.id }
    return null
  }
  if (first.type === 'circle' && second.type === 'circle') {
    return { id, type: 'tangent_cc', c1_id: first.id, c2_id: second.id }
  }
  if (first.type === 'arc' && second.type === 'arc') {
    return { id, type: 'tangent_aa', a1_id: first.id, a2_id: second.id }
  }
  return null
}

function equalPrimitive(id: string, first: SketchEntity, second: SketchEntity): SketchPrimitive | null {
  if (first.type === 'line' && second.type === 'line') {
    return { id, type: 'equal_length', l1_id: first.id, l2_id: second.id }
  }
  if (!isRound(first) || !isRound(second)) return null
  if (first.type === 'circle' && second.type === 'circle') {
    return { id, type: 'equal_radius_cc', c1_id: first.id, c2_id: second.id }
  }
  if (first.type === 'arc' && second.type === 'arc') {
    return { id, type: 'equal_radius_aa', a1_id: first.id, a2_id: second.id }
  }
  // One of each, and PlaneGCS wants the circle first.
  const circle = first.type === 'circle' ? first : second
  const arc = first.type === 'circle' ? second : first
  return { id, type: 'equal_radius_ca', c1_id: circle.id, a2_id: arc.id }
}

/**
 * The PlaneGCS primitive for one constraint, or null when the constraint cannot
 * be expressed against the geometry it names.
 */
export function constraintPrimitive(
  constraint: SketchConstraint,
  entityById: Map<string, SketchEntity>,
): SketchPrimitive | null {
  const [firstId, secondId] = constraint.entityIds
  const first = entityById.get(firstId)
  const second = entityById.get(secondId)
  const id = constraint.id

  switch (constraint.type) {
    case 'horizontal':
      return first?.type === 'line' ? { id, type: 'horizontal_l', l_id: firstId } : null
    case 'vertical':
      return first?.type === 'line' ? { id, type: 'vertical_l', l_id: firstId } : null

    case 'coincident': {
      if (!first || !second || constraint.pointRefs?.length !== 2) return null
      return {
        id,
        type: 'p2p_coincident',
        p1_id: pointId(firstId, constraint.pointRefs[0]),
        p2_id: pointId(secondId, constraint.pointRefs[1]),
      }
    }

    case 'pointOnLine': {
      const ref = constraint.pointRefs?.[0]
      if ((first?.type !== 'line' && first?.type !== 'arc') || second?.type !== 'line'
        || (ref !== 'start' && ref !== 'end')) return null
      return {
        id,
        type: 'point_on_line_pl',
        p_id: pointId(firstId, ref),
        l_id: secondId,
      }
    }

    case 'midpoint': {
      const ref = constraint.pointRefs?.[0]
      if ((first?.type !== 'line' && first?.type !== 'arc') || second?.type !== 'line'
        || (ref !== 'start' && ref !== 'end')) return null
      return {
        id,
        type: 'p2p_symmetric_ppp',
        p1_id: pointId(secondId, 'start'),
        p2_id: pointId(secondId, 'end'),
        p_id: pointId(firstId, ref),
      }
    }

    case 'pointDistance': {
      const [pointRef, datumRef] = constraint.pointRefs ?? []
      if ((first?.type !== 'line' && first?.type !== 'arc') || second?.type !== 'line'
        || (pointRef !== 'start' && pointRef !== 'end')
        || (datumRef !== 'start' && datumRef !== 'end')
        || typeof constraint.value !== 'number') return null
      return {
        id,
        type: 'p2p_distance',
        p1_id: pointId(secondId, datumRef),
        p2_id: pointId(firstId, pointRef),
        distance: constraint.value,
      }
    }

    case 'concentric': {
      if (!first || !second || !isRound(first) || !isRound(second)) return null
      return { id, type: 'p2p_coincident', p1_id: pointId(firstId, 'center'), p2_id: pointId(secondId, 'center') }
    }

    case 'radius': {
      if (typeof constraint.value !== 'number' || !first || !isRound(first)) return null
      return first.type === 'arc'
        ? { id, type: 'arc_radius', a_id: firstId, radius: constraint.value }
        : { id, type: 'circle_radius', c_id: firstId, radius: constraint.value }
    }

    case 'distance': {
      if (typeof constraint.value !== 'number' || first?.type !== 'line') return null
      return {
        id,
        type: 'p2p_distance',
        p1_id: pointId(firstId, 'start'),
        p2_id: pointId(firstId, 'end'),
        distance: constraint.value,
      }
    }

    case 'angle': {
      if (typeof constraint.value !== 'number' || first?.type !== 'line') return null
      return {
        id,
        type: 'p2p_angle',
        p1_id: pointId(firstId, 'start'),
        p2_id: pointId(firstId, 'end'),
        angle: constraint.value,
      }
    }

    case 'parallel':
      if (first?.type !== 'line' || second?.type !== 'line') return null
      return { id, type: 'parallel', l1_id: firstId, l2_id: secondId }

    case 'perpendicular':
      if (first?.type !== 'line' || second?.type !== 'line') return null
      return { id, type: 'perpendicular_ll', l1_id: firstId, l2_id: secondId }

    case 'tangent':
      return first && second ? tangentPrimitive(id, first, second) : null

    case 'equal':
      return first && second ? equalPrimitive(id, first, second) : null
  }
}
