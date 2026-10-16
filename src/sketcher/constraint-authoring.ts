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

/**
 * The ends an entity can be joined by: a line's or an arc's two, or a lone
 * point, which is its own single end. A circle has none.
 */
function endpointsOf(entity: SketchEntity): { ref: SketchPointRef; point: Vec2 }[] {
  if (entity.type === 'point') return [{ ref: 'center', point: entity.position }]
  if (entity.type === 'line') {
    return [{ ref: 'start', point: entity.start }, { ref: 'end', point: entity.end }]
  }
  if (entity.type === 'arc') {
    return [{ ref: 'start', point: arcStartPoint(entity) }, { ref: 'end', point: arcEndPoint(entity) }]
  }
  return []
}

/** Every point an entity has that a constraint can name: ends, and a centre. */
function pointsOf(entity: SketchEntity): { ref: SketchPointRef; point: Vec2 }[] {
  return isRound(entity) ? [...endpointsOf(entity), { ref: 'center', point: entity.center }] : endpointsOf(entity)
}

/** The point of `entity` nearest `target`, which is the one a user drawing them close together meant. */
function nearestPoint(entity: SketchEntity, target: Vec2): { ref: SketchPointRef; point: Vec2 } {
  const points = pointsOf(entity)
  let best = points[0]
  for (const candidate of points) {
    if (Math.hypot(candidate.point[0] - target[0], candidate.point[1] - target[1]) < Math.hypot(best.point[0] - target[0], best.point[1] - target[1])) best = candidate
  }
  return best
}

/** The point a point constraint means: a round entity's centre, a lone point, or the end nearest `target`. */
function pointFor(entity: SketchEntity, target: Vec2): { ref: SketchPointRef; point: Vec2 } {
  return isRound(entity) ? { ref: 'center', point: entity.center } : nearestPoint(entity, target)
}

function lineMidpoint(line: Extract<SketchEntity, { type: 'line' }>): Vec2 {
  return [(line.start[0] + line.end[0]) / 2, (line.start[1] + line.end[1]) / 2]
}

/** The point on the infinite line through `line` nearest `point`, and the distance to it. */
function toLine(point: Vec2, line: Extract<SketchEntity, { type: 'line' }>) {
  const dx = line.end[0] - line.start[0]
  const dy = line.end[1] - line.start[1]
  const length = Math.hypot(dx, dy) || 1
  const along = ((point[0] - line.start[0]) * dx + (point[1] - line.start[1]) * dy) / length
  const foot: Vec2 = [line.start[0] + (dx / length) * along, line.start[1] + (dy / length) * along]
  return { foot, distance: Math.hypot(point[0] - foot[0], point[1] - foot[1]) }
}

/** `point` mirrored across the line through `line`. */
function mirror(point: Vec2, line: Extract<SketchEntity, { type: 'line' }>): Vec2 {
  const { foot } = toLine(point, line)
  return [2 * foot[0] - point[0], 2 * foot[1] - point[1]]
}

function selected(entities: SketchEntity[], selectedIds: string[]): SketchEntity[] {
  return selectedIds
    .map((id) => entities.find((entity) => entity.id === id))
    .filter((entity): entity is SketchEntity => Boolean(entity))
}

/**
 * What a selection can be given. Selection order says who is who: the last
 * entity picked is the target — the line a point goes on, the circle it sits
 * on, the centreline two things are mirrored across.
 */
export function availableConstraints(entities: SketchEntity[], selectedIds: string[]): ConstraintOption[] {
  const picked = selected(entities, selectedIds)

  if (picked.length === 3) {
    const [first, second, axis] = picked
    const mirrorable = first.type === second.type && first.type !== 'arc'
    return axis.type === 'line' && mirrorable
      ? [{ type: 'symmetric', label: 'Symmetric', hint: 'Mirror the first two across the last, a centreline' }]
      : []
  }

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

  if (joinablePoints(first, second).length && joinablePoints(second, first).length) {
    options.push({ type: 'coincident', label: 'Join', hint: 'Hold the nearest two ends together' })
  }

  if (second.type === 'line') {
    options.push(
      { type: 'pointOnLine', label: 'On line', hint: 'Hold the first selection’s nearest end, or its centre, on the line through the last' },
      { type: 'midpoint', label: 'To midpoint', hint: 'Hold the first selection’s nearest end, or its centre, at the last line’s midpoint' },
      { type: 'pointLineDistance', label: 'Distance to line', hint: 'Dimension from the first selection’s nearest end, or its centre, to the last line' },
    )
  }

  if (isRound(second) && endpointsOf(first).length) {
    options.push({ type: 'pointOnCircle', label: second.type === 'arc' ? 'On arc' : 'On circle', hint: 'Hold the first selection’s nearest end on the last selection’s curve' })
  }

  return options
}

/**
 * The points of `entity` that Join can use against `other`: its ends, and its
 * centre too when `other` is a lone point, which is how a point goes to the
 * centre of a circle.
 */
function joinablePoints(entity: SketchEntity, other: SketchEntity) {
  return other.type === 'point' ? pointsOf(entity) : endpointsOf(entity)
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
  for (const a of joinablePoints(first, second)) {
    for (const b of joinablePoints(second, first)) {
      const distance = Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1])
      if (!best || distance < best.distance) best = { refs: [a.ref, b.ref], distance }
    }
  }
  return best?.refs ?? null
}

/**
 * Build the constraints an option stands for — usually one; symmetry between
 * two lines is one per pair of ends — or none when the selection cannot
 * support it after all.
 */
export function buildConstraints(
  type: SketchConstraintType,
  entities: SketchEntity[],
  selectedIds: string[],
): SketchConstraint[] {
  const picked = selected(entities, selectedIds)
  const offered = availableConstraints(entities, selectedIds).some((option) => option.type === type)
  if (!offered) return []

  if (type === 'horizontal' || type === 'vertical') return [{ id: createId(), type, entityIds: [picked[0].id] }]

  if (type === 'symmetric') {
    const [first, second, axis] = picked
    if (axis.type !== 'line') return []
    const pairs: [SketchPointRef, SketchPointRef][] = isRound(first)
      ? [['center', 'center']]
      // Each end of the first goes with whichever end of the second sits
      // nearer its mirror image, so the pairing follows the drawing.
      : endpointsOf(first).map(({ ref, point }) => [ref, nearestPoint(second, mirror(point, axis)).ref])
    return pairs.map((pointRefs) => ({ id: createId(), type, entityIds: [first.id, second.id, axis.id], pointRefs }))
  }

  const [first, second] = picked
  if (type === 'coincident') {
    const refs = nearestEnds(first, second)
    return refs ? [{ id: createId(), type, entityIds: [first.id, second.id], pointRefs: refs }] : []
  }
  if (type === 'concentric') {
    return [{ id: createId(), type, entityIds: [first.id, second.id], pointRefs: ['center', 'center'] }]
  }
  if (type === 'pointOnLine' || type === 'midpoint' || type === 'pointLineDistance') {
    if (second.type !== 'line') return []
    const { ref, point } = pointFor(first, type === 'midpoint' ? lineMidpoint(second) : nearestToLine(first, second))
    const value = type === 'pointLineDistance' ? { value: toLine(point, second).distance } : {}
    return [{ id: createId(), type, entityIds: [first.id, second.id], pointRefs: [ref], ...value }]
  }
  if (type === 'pointOnCircle') {
    if (!isRound(second)) return []
    return [{ id: createId(), type, entityIds: [first.id, second.id], pointRefs: [nearestEndToCurve(first, second)] }]
  }
  return [{ id: createId(), type, entityIds: [first.id, second.id] }]
}

/** The end of `entity` nearest the line through `line`, or its centre if it has no ends. */
function nearestToLine(entity: SketchEntity, line: Extract<SketchEntity, { type: 'line' }>): Vec2 {
  const points = pointsOf(entity)
  return points.reduce((best, candidate) => toLine(candidate.point, line).distance < toLine(best.point, line).distance ? candidate : best).point
}

/** The end of `entity` nearest the curve of a circle or arc. */
function nearestEndToCurve(entity: SketchEntity, round: Extract<SketchEntity, { type: 'circle' | 'arc' }>): SketchPointRef {
  const offCurve = (point: Vec2) => Math.abs(Math.hypot(point[0] - round.center[0], point[1] - round.center[1]) - round.radius)
  return endpointsOf(entity).reduce((best, candidate) => offCurve(candidate.point) < offCurve(best.point) ? candidate : best).ref
}

/** How a constraint reads in the constraint list. */
export function describeConstraint(constraint: SketchConstraint, entities: SketchEntity[]): string {
  const names = constraint.entityIds.map((id) => {
    const index = entities.findIndex((entity) => entity.id === id)
    if (index < 0) return '?'
    const entity = entities[index]
    const kind = { line: 'Line', arc: 'Arc', circle: 'Circle', point: 'Point' }[entity.type]
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
  pointOnCircle: 'On curve',
  pointLineDistance: 'Distance to line',
  symmetric: 'Symmetric',
}
