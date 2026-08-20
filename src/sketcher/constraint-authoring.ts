import { arcEndPoint, arcStartPoint } from '../core/arc-geometry'
import {
  createId,
  type SketchConstraint,
  type SketchConstraintType,
  type SketchEntity,
  type SketchPointRef,
  type Vec2,
} from '../core/model'

/**
 * Which relationships a selection can be given, and how to build them.
 *
 * Kept apart from the sketcher component because these are rules about
 * geometry, not about rendering: whether two entities can be made tangent is
 * the same question whether it is asked by a button, a keyboard shortcut or a
 * test.
 *
 * Only constraints PlaneGCS can actually express for the selected kinds are
 * offered. Presenting one that would be silently dropped is worse than not
 * presenting it, because the sketch then looks constrained and is not.
 */

export type ConstraintOption = {
  type: SketchConstraintType
  label: string
  /** Why this is being offered, shown as the button's title. */
  hint: string
}

/** A round entity: one with a centre and a radius. */
function isRound(entity: SketchEntity): entity is Extract<SketchEntity, { type: 'circle' | 'arc' }> {
  return entity.type === 'circle' || entity.type === 'arc'
}

/** Entities with two ends that can be joined to something: lines and arcs. */
function endpointsOf(entity: SketchEntity): { ref: SketchPointRef; point: Vec2 }[] {
  if (entity.type === 'line') {
    return [{ ref: 'start', point: entity.start }, { ref: 'end', point: entity.end }]
  }
  if (entity.type === 'arc') {
    return [{ ref: 'start', point: arcStartPoint(entity) }, { ref: 'end', point: arcEndPoint(entity) }]
  }
  return []
}

function selected(entities: SketchEntity[], selectedIds: string[]): SketchEntity[] {
  return selectedIds
    .map((id) => entities.find((entity) => entity.id === id))
    .filter((entity): entity is SketchEntity => Boolean(entity))
}

export function availableConstraints(entities: SketchEntity[], selectedIds: string[]): ConstraintOption[] {
  const picked = selected(entities, selectedIds)

  if (picked.length === 1) {
    const [only] = picked
    if (only.type !== 'line') return []
    return [
      { type: 'horizontal', label: 'Horizontal', hint: 'Hold this line parallel to the X axis' },
      { type: 'vertical', label: 'Vertical', hint: 'Hold this line parallel to the Y axis' },
    ]
  }

  if (picked.length !== 2) return []
  const [first, second] = picked
  const options: ConstraintOption[] = []
  const lines = picked.filter((entity) => entity.type === 'line')
  const round = picked.filter(isRound)

  if (lines.length === 2) {
    options.push(
      { type: 'parallel', label: 'Parallel', hint: 'Hold these two lines in the same direction' },
      { type: 'perpendicular', label: 'Perpendicular', hint: 'Hold these two lines at a right angle' },
      { type: 'equal', label: 'Equal', hint: 'Hold these two lines at the same length' },
    )
  }

  if (round.length === 2) {
    options.push(
      { type: 'concentric', label: 'Concentric', hint: 'Hold these two centres together' },
      { type: 'equal', label: 'Equal', hint: 'Hold these two radii the same' },
    )
  }

  // Tangency needs a curve. Two straight lines cannot be tangent, and PlaneGCS
  // has no arc-to-circle variant, so neither is offered.
  const tangentable = (lines.length === 1 && round.length === 1)
    || (round.length === 2 && first.type === second.type)
  if (tangentable) {
    options.push({ type: 'tangent', label: 'Tangent', hint: 'Meet smoothly, with no corner' })
  }

  if (endpointsOf(first).length && endpointsOf(second).length) {
    options.push({ type: 'coincident', label: 'Join', hint: 'Hold the nearest two ends together' })
  }

  return options
}

/**
 * The nearest pair of ends between two entities.
 *
 * Joining geometry means joining the ends the user already put next to each
 * other; picking by proximity is what makes a single "Join" button do the
 * obvious thing instead of asking which of four combinations was meant.
 */
function nearestEnds(first: SketchEntity, second: SketchEntity): [SketchPointRef, SketchPointRef] | null {
  let best: { refs: [SketchPointRef, SketchPointRef]; distance: number } | null = null
  for (const a of endpointsOf(first)) {
    for (const b of endpointsOf(second)) {
      const distance = Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1])
      if (!best || distance < best.distance) best = { refs: [a.ref, b.ref], distance }
    }
  }
  return best?.refs ?? null
}

/**
 * Build the constraint an option stands for, or null when the selection cannot
 * support it after all.
 */
export function buildConstraint(
  type: SketchConstraintType,
  entities: SketchEntity[],
  selectedIds: string[],
): SketchConstraint | null {
  const picked = selected(entities, selectedIds)

  if (type === 'horizontal' || type === 'vertical') {
    const [only] = picked
    if (picked.length !== 1 || only.type !== 'line') return null
    return { id: createId(), type, entityIds: [only.id] }
  }

  if (picked.length !== 2) return null
  const [first, second] = picked

  if (type === 'coincident') {
    const refs = nearestEnds(first, second)
    if (!refs) return null
    return { id: createId(), type, entityIds: [first.id, second.id], pointRefs: refs }
  }

  if (type === 'concentric') {
    if (!isRound(first) || !isRound(second)) return null
    return { id: createId(), type, entityIds: [first.id, second.id], pointRefs: ['center', 'center'] }
  }

  const offered = availableConstraints(entities, selectedIds).some((option) => option.type === type)
  if (!offered) return null
  return { id: createId(), type, entityIds: [first.id, second.id] }
}

/** How a constraint reads in the constraint list. */
export function describeConstraint(constraint: SketchConstraint, entities: SketchEntity[]): string {
  const names = constraint.entityIds.map((id) => {
    const index = entities.findIndex((entity) => entity.id === id)
    if (index < 0) return '?'
    const entity = entities[index]
    const kind = entity.type === 'line' ? 'Line' : entity.type === 'arc' ? 'Arc' : 'Circle'
    return `${kind} ${index + 1}`
  })
  return names.join(' · ')
}

export const CONSTRAINT_LABELS: Record<SketchConstraintType, string> = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  coincident: 'Joined',
  radius: 'Radius',
  distance: 'Distance',
  angle: 'Angle',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  equal: 'Equal',
  concentric: 'Concentric',
  pointOnLine: 'Point on line',
  midpoint: 'Midpoint',
  pointDistance: 'Along line',
}
