import {
  TAU,
  angleAt,
  angleWithinArc,
  arcEndPoint,
  arcStartPoint,
  counterClockwiseSpan,
  normalizeAngle,
  normalizeArc,
  pointOnCircle,
} from '../core/arc-geometry'
import { SKETCH_INTERSECTION_DISTANCE_MM, SKETCH_TRIM_MIN_PIECE_MM } from '../core/tolerance-policy'
import { createId, type ArcEntity, type LineEntity, type SketchConstraint, type SketchEntity, type Vec2 } from '../core/model'

/**
 * Trim: cut a sketch curve back to where it meets its neighbours.
 *
 * Trim is the tool that turns overlapping construction into a profile, and it is
 * the prerequisite for sketch fillet and offset, which are both "split here, then
 * add geometry between the pieces".
 *
 * The model is deliberately the one every mechanical CAD user already has: the
 * click point picks a *piece*, where the pieces of a curve are the spans between
 * its intersections with every other curve in the sketch, and that piece is
 * removed. Everything else about the sketch — the other geometry, the surviving
 * constraints, the solver anchor — is left as it was.
 *
 * Nothing here mutates its input. The caller hands the result to PlaneGCS and
 * commits what comes back, exactly as it does for every other sketch edit.
 */

type CircleLike = { center: Vec2; radius: number }

function circleOf(entity: SketchEntity): CircleLike | null {
  return entity.type === 'line' ? null : { center: entity.center, radius: entity.radius }
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

/** Whether a point lies on the entity's own span, within tolerance. */
function liesOnEntity(entity: SketchEntity, point: Vec2): boolean {
  if (entity.type === 'line') {
    const dx = entity.end[0] - entity.start[0]
    const dy = entity.end[1] - entity.start[1]
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared < 1e-18) return false
    const t = ((point[0] - entity.start[0]) * dx + (point[1] - entity.start[1]) * dy) / lengthSquared
    const slack = SKETCH_INTERSECTION_DISTANCE_MM / Math.sqrt(lengthSquared)
    return t >= -slack && t <= 1 + slack
  }
  if (entity.type === 'circle') return true
  return angleWithinArc(entity, angleAt(entity.center, point))
}

function intersectLines(a: LineEntity, b: LineEntity): Vec2[] {
  const rx = a.end[0] - a.start[0]
  const ry = a.end[1] - a.start[1]
  const sx = b.end[0] - b.start[0]
  const sy = b.end[1] - b.start[1]
  const denominator = cross(rx, ry, sx, sy)
  // Parallel lines are left alone, collinear overlaps included: there is no
  // single point to cut at, and guessing one would trim a length the user never
  // pointed at.
  if (Math.abs(denominator) < 1e-12) return []
  const qpx = b.start[0] - a.start[0]
  const qpy = b.start[1] - a.start[1]
  const t = cross(qpx, qpy, sx, sy) / denominator
  return [[a.start[0] + t * rx, a.start[1] + t * ry]]
}

function intersectLineCircle(line: LineEntity, circle: CircleLike): Vec2[] {
  const dx = line.end[0] - line.start[0]
  const dy = line.end[1] - line.start[1]
  const fx = line.start[0] - circle.center[0]
  const fy = line.start[1] - circle.center[1]
  const a = dx * dx + dy * dy
  if (a < 1e-18) return []
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - circle.radius * circle.radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []
  const root = Math.sqrt(Math.max(0, discriminant))
  const parameters = discriminant < 1e-12 ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)]
  return parameters.map((t): Vec2 => [line.start[0] + t * dx, line.start[1] + t * dy])
}

function intersectCircles(a: CircleLike, b: CircleLike): Vec2[] {
  const dx = b.center[0] - a.center[0]
  const dy = b.center[1] - a.center[1]
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-12) return [] // Concentric: no crossing, or the same circle.
  if (distance > a.radius + b.radius + SKETCH_INTERSECTION_DISTANCE_MM) return []
  if (distance < Math.abs(a.radius - b.radius) - SKETCH_INTERSECTION_DISTANCE_MM) return []
  const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance)
  const heightSquared = a.radius * a.radius - along * along
  const height = Math.sqrt(Math.max(0, heightSquared))
  const baseX = a.center[0] + (along * dx) / distance
  const baseY = a.center[1] + (along * dy) / distance
  if (height < 1e-9) return [[baseX, baseY]]
  const offsetX = (height * -dy) / distance
  const offsetY = (height * dx) / distance
  return [
    [baseX + offsetX, baseY + offsetY],
    [baseX - offsetX, baseY - offsetY],
  ]
}

/**
 * Every point where two sketch entities cross.
 *
 * Both entities are asked whether the candidate is on their own span, so an arc
 * only reports crossings within its sweep and a line only within its length —
 * the infinite line and the full circle are solving devices, not the geometry.
 */
export function intersectSketchEntities(a: SketchEntity, b: SketchEntity): Vec2[] {
  const circleA = circleOf(a)
  const circleB = circleOf(b)
  let candidates: Vec2[] = []
  if (a.type === 'line' && b.type === 'line') candidates = intersectLines(a, b)
  else if (a.type === 'line' && circleB) candidates = intersectLineCircle(a, circleB)
  else if (b.type === 'line' && circleA) candidates = intersectLineCircle(b, circleA)
  else if (circleA && circleB) candidates = intersectCircles(circleA, circleB)
  return candidates.filter((point) => liesOnEntity(a, point) && liesOnEntity(b, point))
}

/** Where every other entity crosses this one, as parameters along it. */
function crossingParameters(target: SketchEntity, others: SketchEntity[]): number[] {
  const found: number[] = []
  for (const other of others) {
    for (const point of intersectSketchEntities(target, other)) {
      const parameter = parameterAt(target, point)
      if (parameter === null) continue
      if (!found.some((existing) => Math.abs(existing - parameter) < 1e-9)) found.push(parameter)
    }
  }
  return found.sort((left, right) => left - right)
}

/**
 * Where a point sits along the entity.
 *
 * A line is parameterised 0..1 along its length; an arc 0..1 across its sweep;
 * a circle 0..1 counter-clockwise from the positive X axis, which is arbitrary
 * but consistent, and a closed curve has no natural start to prefer.
 */
function parameterAt(entity: SketchEntity, point: Vec2): number | null {
  if (entity.type === 'line') {
    const dx = entity.end[0] - entity.start[0]
    const dy = entity.end[1] - entity.start[1]
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared < 1e-18) return null
    return ((point[0] - entity.start[0]) * dx + (point[1] - entity.start[1]) * dy) / lengthSquared
  }
  if (entity.type === 'circle') return normalizeAngle(angleAt(entity.center, point)) / TAU
  const sweep = entity.endAngle - entity.startAngle
  if (sweep <= 1e-12) return null
  return counterClockwiseSpan(entity.startAngle, angleAt(entity.center, point)) / sweep
}

function lengthOf(entity: SketchEntity): number {
  if (entity.type === 'line') return Math.hypot(entity.end[0] - entity.start[0], entity.end[1] - entity.start[1])
  if (entity.type === 'circle') return TAU * entity.radius
  return (entity.endAngle - entity.startAngle) * entity.radius
}

function pointAtParameter(entity: SketchEntity, parameter: number): Vec2 {
  if (entity.type === 'line') {
    return [
      entity.start[0] + (entity.end[0] - entity.start[0]) * parameter,
      entity.start[1] + (entity.end[1] - entity.start[1]) * parameter,
    ]
  }
  if (entity.type === 'circle') return pointOnCircle(entity.center, entity.radius, parameter * TAU)
  return pointOnCircle(entity.center, entity.radius, entity.startAngle + (entity.endAngle - entity.startAngle) * parameter)
}

/** One surviving span of a trimmed entity, as an entity of its own. */
function pieceOf(entity: SketchEntity, from: number, to: number, id: string): SketchEntity | null {
  if (to - from < SKETCH_TRIM_MIN_PIECE_MM / Math.max(lengthOf(entity), 1e-9)) return null
  if (entity.type === 'line') {
    const piece: LineEntity = { ...entity, id, start: pointAtParameter(entity, from), end: pointAtParameter(entity, to) }
    return piece
  }
  // Both an arc and a circle become an arc: a trimmed closed curve is open by
  // definition, so `circle` is not a shape a trim result can have.
  const base = entity.type === 'circle'
    ? { center: entity.center, radius: entity.radius, startAngle: 0, endAngle: TAU }
    : entity
  const startAngle = base.startAngle + (base.endAngle - base.startAngle) * from
  const endAngle = base.startAngle + (base.endAngle - base.startAngle) * to
  const normalized = normalizeArc(base.center, base.radius, startAngle, endAngle)
  const piece: ArcEntity = {
    id,
    type: 'arc',
    center: normalized.center,
    radius: normalized.radius,
    startAngle: normalized.startAngle,
    endAngle: normalized.endAngle,
    construction: entity.construction,
  }
  return piece
}

/**
 * Constraints that a trim leaves meaningful.
 *
 * A trim moves endpoints and changes lengths, so anything asserting where an
 * endpoint is or how long something is no longer describes the geometry that
 * remains — keeping those would hand PlaneGCS a conflict the user never wrote,
 * and the solver would drag the sketch somewhere to satisfy it.
 *
 * What survives is what is still true of a shortened curve: it points the same
 * way, and a piece of a circle has the circle's radius. Those are re-applied to
 * every piece, so trimming a horizontal line leaves two horizontal lines.
 */
const CONSTRAINTS_SURVIVING_TRIM: readonly SketchConstraint['type'][] = ['horizontal', 'vertical', 'radius']

/**
 * The span of the target that a click asks to remove, in the target's own
 * parameters.
 *
 * This is the whole decision the trim tool makes, kept in one place so that what
 * the preview highlights and what the edit removes cannot drift apart.
 *
 * For an open curve the span runs between the crossings either side of the click,
 * falling back to the curve's own ends where there is no crossing on that side —
 * so a click on a curve nothing touches spans the whole thing and removes it.
 *
 * For a circle there are no ends to fall back on: it takes two crossings to
 * divide a closed curve at all, and with fewer the span is the entire turn. `to`
 * may be less than `from`, meaning the removed span crosses the seam at angle
 * zero; the caller reads it cyclically.
 */
function removalSpan(entities: SketchEntity[], target: SketchEntity, point: Vec2): { from: number; to: number } | null {
  const clicked = parameterAt(target, point)
  if (clicked === null) return null
  const crossings = crossingParameters(target, entities.filter((entity) => entity.id !== target.id))

  if (target.type === 'circle') {
    if (crossings.length < 2) return { from: 1, to: 1 } // Nothing divides it: remove the whole circle.
    const to = crossings.find((parameter) => parameter > clicked) ?? crossings[0]
    const before = crossings.filter((parameter) => parameter < clicked)
    const from = before.length ? before[before.length - 1] : crossings[crossings.length - 1]
    return { from, to }
  }

  const inside = crossings.filter((parameter) => parameter > 1e-9 && parameter < 1 - 1e-9)
  return {
    from: [...inside].reverse().find((parameter) => parameter < clicked) ?? 0,
    to: inside.find((parameter) => parameter > clicked) ?? 1,
  }
}

/**
 * The span a trim click would remove, as a polyline to draw under the cursor.
 *
 * Shown before the click so the tool never surprises: trim is destructive and
 * "which piece did it think I meant" is the one question it has to answer up
 * front.
 */
export function trimRemovalPreview(entities: SketchEntity[], targetId: string, point: Vec2, samples = 24): Vec2[] | null {
  const target = entities.find((entity) => entity.id === targetId)
  if (!target) return null
  const span = removalSpan(entities, target, point)
  if (!span) return null
  const from = span.from
  const to = target.type === 'circle' && span.to <= span.from ? span.to + 1 : span.to
  if (target.type === 'circle' && span.from >= 1) return sampleSpan(target, 0, 1, samples)
  if (to - from < 1e-12) return null
  return sampleSpan(target, from, to, target.type === 'line' ? 2 : samples)
}

function sampleSpan(entity: SketchEntity, from: number, to: number, samples: number): Vec2[] {
  const steps = Math.max(2, Math.ceil(samples))
  const points: Vec2[] = []
  for (let index = 0; index < steps; index += 1) {
    points.push(pointAtParameter(entity, from + ((to - from) * index) / (steps - 1)))
  }
  return points
}

export type TrimOutcome = {
  entities: SketchEntity[]
  constraints: SketchConstraint[]
  /** How many pieces the picked entity was reduced to: 0 means it was removed. */
  remainingPieces: number
}

/**
 * Remove the span of `targetId` that contains `point`.
 *
 * Returns null when there is nothing to do, so a click on empty space or a
 * missing id is not an undo step.
 *
 * With no crossing on either side of the click the whole entity goes, which is
 * what a user asking to trim an isolated line means; a circle needs two
 * crossings to become an arc, and with fewer it is likewise removed whole.
 */
export function trimSketchEntity(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  targetId: string,
  point: Vec2,
): TrimOutcome | null {
  const target = entities.find((entity) => entity.id === targetId)
  if (!target) return null
  const span = removalSpan(entities, target, point)
  if (!span) return null

  const pieces: SketchEntity[] = []
  if (target.type === 'circle') {
    // A trimmed circle leaves at most one piece: the rest of the turn, running
    // counter-clockwise out of the removed span's far end back into its near one.
    const survivor = span.from >= 1 ? null : pieceOf(target, span.to, span.from + 1, target.id)
    if (survivor) pieces.push(survivor)
  } else {
    const head = span.from > 0 ? pieceOf(target, 0, span.from, target.id) : null
    const tail = span.to < 1 ? pieceOf(target, span.to, 1, head ? createId() : target.id) : null
    if (head) pieces.push(head)
    if (tail) pieces.push(tail)
  }

  // Nothing changed: the click found no piece to remove and the entity is intact.
  if (pieces.length === 1 && pieces[0].id === target.id && sameGeometry(pieces[0], target)) return null

  const kept = constraints.filter((constraint) => !constraint.entityIds.includes(targetId))
  const reapplied = constraints
    .filter((constraint) =>
      constraint.entityIds.length === 1 &&
      constraint.entityIds[0] === targetId &&
      CONSTRAINTS_SURVIVING_TRIM.includes(constraint.type) &&
      // A radius constraint only survives onto a piece that is still curved.
      (constraint.type !== 'radius' || target.type !== 'line'))
    .flatMap((constraint) => pieces.map((piece) => ({ ...constraint, id: createId(), entityIds: [piece.id] })))

  return {
    entities: entities.flatMap((entity) => (entity.id === targetId ? pieces : [entity])),
    constraints: [...kept, ...reapplied],
    remainingPieces: pieces.length,
  }
}

function sameGeometry(a: SketchEntity, b: SketchEntity): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'line' && b.type === 'line') {
    return a.start[0] === b.start[0] && a.start[1] === b.start[1] && a.end[0] === b.end[0] && a.end[1] === b.end[1]
  }
  if (a.type === 'arc' && b.type === 'arc') {
    return a.startAngle === b.startAngle && a.endAngle === b.endAngle && a.radius === b.radius
  }
  return a.type === 'circle' && b.type === 'circle' && a.radius === b.radius
}

/**
 * Which entity a trim click is aimed at, and how far the pointer was from it.
 *
 * Distance is measured to the curve itself rather than to a bounding box, so a
 * click inside a large circle does not capture it ahead of a line running under
 * the cursor.
 */
export function pickTrimTarget(entities: SketchEntity[], point: Vec2, tolerance: number): SketchEntity | null {
  let best: { entity: SketchEntity; distance: number } | null = null
  for (const entity of entities) {
    const distance = distanceToEntity(entity, point)
    if (distance > tolerance) continue
    if (!best || distance < best.distance) best = { entity, distance }
  }
  return best?.entity ?? null
}

function distanceToEntity(entity: SketchEntity, point: Vec2): number {
  if (entity.type === 'line') {
    const dx = entity.end[0] - entity.start[0]
    const dy = entity.end[1] - entity.start[1]
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared < 1e-18) return Math.hypot(point[0] - entity.start[0], point[1] - entity.start[1])
    const t = Math.max(0, Math.min(1, ((point[0] - entity.start[0]) * dx + (point[1] - entity.start[1]) * dy) / lengthSquared))
    return Math.hypot(point[0] - (entity.start[0] + t * dx), point[1] - (entity.start[1] + t * dy))
  }
  const radial = Math.abs(Math.hypot(point[0] - entity.center[0], point[1] - entity.center[1]) - entity.radius)
  if (entity.type === 'circle') return radial
  if (angleWithinArc(entity, angleAt(entity.center, point))) return radial
  const toStart = Math.hypot(point[0] - arcStartPoint(entity)[0], point[1] - arcStartPoint(entity)[1])
  const toEnd = Math.hypot(point[0] - arcEndPoint(entity)[0], point[1] - arcEndPoint(entity)[1])
  return Math.min(toStart, toEnd)
}
