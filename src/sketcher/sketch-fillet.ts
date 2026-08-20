import { angleAt, counterClockwiseSpan, normalizeArc } from '../core/arc-geometry'
import { createId, type ArcEntity, type LineEntity, type SketchConstraint, type SketchEntity, type Vec2 } from '../core/model'
import { SKETCH_INTERSECTION_DISTANCE_MM } from '../core/tolerance-policy'

/**
 * Sketch fillet: round the corner where two lines meet.
 *
 * This is the second half of trim. Trim decides where to cut a curve; a fillet
 * cuts both curves back to their tangent points and puts an arc between them, so
 * the geometry here is the tangent construction and the constraints that keep it
 * meaning "rounded corner" rather than "an arc that happens to sit near a gap".
 *
 * The result is fully constrained on purpose: tangency to both lines, a radius
 * dimension, and coincidence at each end. Without those, the next solve would be
 * free to pull the arc off the corner, and the user would have drawn a round
 * shape rather than expressed a rounded corner. Being constrained is also what
 * makes the radius editable afterwards from the constraint list.
 *
 * Only line-to-line corners are handled. Arc-to-line and arc-to-arc need a
 * different tangent construction and are reported as unsupported rather than
 * approximated, because a fillet that is nearly tangent is a defect that reaches
 * the kernel as a sliver face.
 */

export type SketchFilletResult =
  | {
      ok: true
      entities: SketchEntity[]
      constraints: SketchConstraint[]
      /** The arc that was inserted, so the caller can select or dimension it. */
      arcId: string
    }
  | {
      ok: false
      reason: string
      /** The largest radius that would fit, when that is what went wrong. */
      maximumRadius?: number
    }

const subtract = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const scale = (a: Vec2, factor: number): Vec2 => [a[0] * factor, a[1] * factor]
const length = (a: Vec2) => Math.hypot(a[0], a[1])

function normalize(a: Vec2): Vec2 | null {
  const magnitude = length(a)
  return magnitude < 1e-12 ? null : [a[0] / magnitude, a[1] / magnitude]
}

/** Where two infinite lines meet, or null if they are parallel. */
function infiniteIntersection(a: LineEntity, b: LineEntity): Vec2 | null {
  const r = subtract(a.end, a.start)
  const s = subtract(b.end, b.start)
  const denominator = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(denominator) < 1e-12) return null
  const qp = subtract(b.start, a.start)
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator
  return add(a.start, scale(r, t))
}

/**
 * Which end of the line is the corner, and which way the line runs away from it.
 *
 * Taking the nearer endpoint as the corner means this works both for lines that
 * already share an endpoint and for lines that cross, where the corner is inside
 * one of them and the shorter side is what gets cut away.
 */
function cornerSide(line: LineEntity, corner: Vec2) {
  const toStart = length(subtract(line.start, corner))
  const toEnd = length(subtract(line.end, corner))
  const nearRef: 'start' | 'end' = toStart <= toEnd ? 'start' : 'end'
  const far = nearRef === 'start' ? line.end : line.start
  return { nearRef, far, direction: normalize(subtract(far, corner)), available: Math.max(toStart, toEnd) }
}

/**
 * Round the corner between two lines with an arc of the given radius.
 *
 * Nothing is mutated: the caller receives the full entity and constraint lists to
 * hand to the solver.
 */
export function filletSketchCorner(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  firstId: string,
  secondId: string,
  radius: number,
): SketchFilletResult {
  if (!(radius > 0)) return { ok: false, reason: 'Enter a fillet radius greater than zero.' }
  const first = entities.find((entity) => entity.id === firstId)
  const second = entities.find((entity) => entity.id === secondId)
  if (!first || !second || firstId === secondId) return { ok: false, reason: 'Select two different sketch entities.' }
  if (first.type !== 'line' || second.type !== 'line') {
    return { ok: false, reason: 'Sketch fillet currently rounds corners between two lines. Select two lines.' }
  }

  const corner = infiniteIntersection(first, second)
  if (!corner) return { ok: false, reason: 'These lines are parallel, so they have no corner to round.' }

  const a = cornerSide(first, corner)
  const b = cornerSide(second, corner)
  if (!a.direction || !b.direction) return { ok: false, reason: 'One of these lines has no length.' }

  const cosine = Math.min(1, Math.max(-1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1]))
  const included = Math.acos(cosine)
  // Defensive: two lines that genuinely meet at a point cannot be collinear, so
  // the parallel check above already covers the real cases. This keeps the
  // trigonometry below from dividing by a vanishing tangent or sine if a
  // near-degenerate pair slips past it.
  if (included < 1e-6 || Math.PI - included < 1e-6) {
    return { ok: false, reason: 'These lines are too nearly collinear to round.' }
  }

  const half = included / 2
  const tangentDistance = radius / Math.tan(half)
  // The corner has to leave enough line on both sides for the tangent point to
  // land on. Reporting the radius that would fit follows the exact fillet's
  // behaviour: a limit is something to tell the user, not a failure.
  const shortest = Math.min(a.available, b.available)
  if (tangentDistance > shortest - SKETCH_INTERSECTION_DISTANCE_MM) {
    return {
      ok: false,
      reason: 'That radius is larger than these lines can carry.',
      maximumRadius: shortest * Math.tan(half),
    }
  }

  const tangentA = add(corner, scale(a.direction, tangentDistance))
  const tangentB = add(corner, scale(b.direction, tangentDistance))
  const bisector = normalize(add(a.direction, b.direction))
  if (!bisector) return { ok: false, reason: 'These lines are collinear, so they have no corner to round.' }
  const center = add(corner, scale(bisector, radius / Math.sin(half)))

  // The fillet is the minor arc between the tangent points: it sweeps the
  // supplement of the corner angle. Whichever ordering produces that sweep tells
  // us which tangent point is the arc's start.
  const sweep = Math.PI - included
  const angleA = angleAt(center, tangentA)
  const angleB = angleAt(center, tangentB)
  const startsAtA = Math.abs(counterClockwiseSpan(angleA, angleB) - sweep) <= Math.abs(counterClockwiseSpan(angleB, angleA) - sweep)
  const normalized = normalizeArc(center, radius, startsAtA ? angleA : angleB, startsAtA ? angleB : angleA)

  const arc: ArcEntity = {
    id: createId(),
    type: 'arc',
    center: normalized.center,
    radius: normalized.radius,
    startAngle: normalized.startAngle,
    endAngle: normalized.endAngle,
    construction: first.construction && second.construction,
  }

  const trim = (line: LineEntity, side: ReturnType<typeof cornerSide>, tangent: Vec2): LineEntity =>
    side.nearRef === 'start' ? { ...line, start: tangent } : { ...line, end: tangent }

  const nextEntities = entities.flatMap((entity) => {
    if (entity.id === firstId) return [trim(first, a, tangentA)]
    if (entity.id === secondId) return [trim(second, b, tangentB)]
    return [entity]
  })
  nextEntities.push(arc)

  return {
    ok: true,
    arcId: arc.id,
    entities: nextEntities,
    constraints: [...survivingConstraints(constraints, firstId, secondId), ...filletConstraints(arc.id, firstId, secondId, a.nearRef, b.nearRef, startsAtA, radius)],
  }
}

/**
 * The corner's old constraints, minus the ones the fillet invalidates.
 *
 * Two go: the coincidence that used to hold the corner together, which the arc
 * now spans, and any length dimension on either line, because both lines are
 * shorter than the number those dimensions assert. Everything else — direction,
 * parallelism, coincidences at the far ends — is still true and is left alone.
 */
function survivingConstraints(constraints: SketchConstraint[], firstId: string, secondId: string): SketchConstraint[] {
  return constraints.filter((constraint) => {
    const touchesBoth = constraint.entityIds.includes(firstId) && constraint.entityIds.includes(secondId)
    if (touchesBoth && constraint.type === 'coincident') return false
    const isLength = constraint.type === 'distance' || constraint.type === 'pointDistance'
    return !(isLength && constraint.entityIds.some((id) => id === firstId || id === secondId))
  })
}

function filletConstraints(
  arcId: string,
  firstId: string,
  secondId: string,
  firstRef: 'start' | 'end',
  secondRef: 'start' | 'end',
  startsAtFirst: boolean,
  radius: number,
): SketchConstraint[] {
  return [
    { id: createId(), type: 'tangent', entityIds: [firstId, arcId] },
    { id: createId(), type: 'tangent', entityIds: [secondId, arcId] },
    { id: createId(), type: 'radius', entityIds: [arcId], value: radius },
    {
      id: createId(),
      type: 'coincident',
      entityIds: [firstId, arcId],
      pointRefs: [firstRef, startsAtFirst ? 'start' : 'end'],
    },
    {
      id: createId(),
      type: 'coincident',
      entityIds: [secondId, arcId],
      pointRefs: [secondRef, startsAtFirst ? 'end' : 'start'],
    },
  ]
}
