import type { Vec2 } from './model'

/**
 * Arc maths for sketch geometry.
 *
 * An arc is described by its centre, radius and the two angles it sweeps
 * between, and it always sweeps *counter-clockwise*, so `endAngle` is greater
 * than `startAngle`. Storing it this way — rather than as two endpoints and a
 * bulge — is what lets the compiler find every consumer that still assumes a
 * sketch entity is either a line or a full circle: an arc carrying `start` and
 * `end` would compile straight into those branches and silently behave as its
 * own chord.
 *
 * The convention deliberately matches the drawing layer's projected arcs
 * (`drawing/curve-geometry.ts`), so an arc means the same thing in a sketch and
 * on a sheet. These functions take plain values rather than entities so both
 * layers can share them without either depending on the other's types.
 */

export const TAU = Math.PI * 2

/** Anything shaped like an arc: sketch entities and bare descriptions alike. */
export type ArcLike = {
  center: Vec2
  radius: number
  startAngle: number
  endAngle: number
}

/** Reduce an angle to [0, 2π). */
export function normalizeAngle(angle: number): number {
  const wrapped = angle % TAU
  return wrapped < 0 ? wrapped + TAU : wrapped
}

/** How far counter-clockwise it is from one angle to another, in [0, 2π). */
export function counterClockwiseSpan(from: number, to: number): number {
  return normalizeAngle(to - from)
}

export function angleAt(center: Vec2, point: Vec2): number {
  return Math.atan2(point[1] - center[1], point[0] - center[0])
}

export function pointOnCircle(center: Vec2, radius: number, angle: number): Vec2 {
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
}

/** How far the arc sweeps, in (0, 2π]. */
export function arcSweep(arc: ArcLike): number {
  return arc.endAngle - arc.startAngle
}

/**
 * Put an arc into the counter-clockwise form the rest of the code expects.
 *
 * A sweep that runs clockwise describes the same set of points read the other
 * way round, so the angles are exchanged rather than rejected.
 */
export function normalizeArc(center: Vec2, radius: number, startAngle: number, endAngle: number): ArcLike {
  const sweep = counterClockwiseSpan(startAngle, endAngle)
  const start = normalizeAngle(startAngle)
  // A zero sweep means the two angles coincide; treat that as a full turn so an
  // arc never collapses to a point and vanish from a profile.
  return { center, radius, startAngle: start, endAngle: start + (sweep < 1e-9 ? TAU : sweep) }
}

/**
 * The arc through a centre and two points, sweeping counter-clockwise from
 * `start` to `end`. This is what the centre-point arc tool draws.
 *
 * The radius comes from the start point alone: the end click sets direction,
 * not distance, so an imprecise second click cannot make the arc non-circular.
 */
export function arcFromCenterAndPoints(center: Vec2, start: Vec2, end: Vec2): ArcLike | null {
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  if (!Number.isFinite(radius) || radius <= 1e-9) return null
  const startAngle = angleAt(center, start)
  const endAngle = angleAt(center, end)
  // A centre-point arc with coincident start/end directions is not a circle.
  // Full turns belong to CircleEntity; accepting one here makes a missed final
  // click silently change the kind of geometry the user asked to create.
  if (counterClockwiseSpan(startAngle, endAngle) <= 1e-9) return null
  return normalizeArc(center, radius, startAngle, endAngle)
}

/**
 * The unique circular arc through three points.
 *
 * The first two points are the endpoints and the third chooses which side of
 * their chord the arc occupies. When that path is clockwise, the endpoints are
 * exchanged to retain the document's counter-clockwise storage convention;
 * the resulting geometric curve is unchanged.
 */
export function arcFromThreePoints(start: Vec2, end: Vec2, through: Vec2): ArcLike | null {
  const ax = start[0]
  const ay = start[1]
  const bx = end[0]
  const by = end[1]
  const cx = through[0]
  const cy = through[1]
  const determinant = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-9) return null

  const a2 = ax * ax + ay * ay
  const b2 = bx * bx + by * by
  const c2 = cx * cx + cy * cy
  const center: Vec2 = [
    (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / determinant,
    (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / determinant,
  ]
  const radius = Math.hypot(ax - center[0], ay - center[1])
  if (!Number.isFinite(radius) || radius <= 1e-9) return null

  const startAngle = angleAt(center, start)
  const endAngle = angleAt(center, end)
  const throughAngle = angleAt(center, through)
  const forward = normalizeArc(center, radius, startAngle, endAngle)
  if (angleWithinArc(forward, throughAngle)) return forward
  return normalizeArc(center, radius, endAngle, startAngle)
}

export type TangentArc = ArcLike & { joinRef: 'start' | 'end' }

/**
 * An arc leaving `join` in `tangent` direction and ending at `end`.
 *
 * The centre must lie on the line normal to the tangent at the join. Solving
 * the equal-radius equation against the requested endpoint gives the signed
 * distance along that normal directly, avoiding iterative geometry.
 */
export function tangentArcFromEndpoint(join: Vec2, end: Vec2, tangent: Vec2): TangentArc | null {
  const tangentLength = Math.hypot(tangent[0], tangent[1])
  const dx = end[0] - join[0]
  const dy = end[1] - join[1]
  const chordSquared = dx * dx + dy * dy
  if (!Number.isFinite(tangentLength) || tangentLength <= 1e-9 || chordSquared <= 1e-9) return null
  const unit: Vec2 = [tangent[0] / tangentLength, tangent[1] / tangentLength]
  const normal: Vec2 = [-unit[1], unit[0]]
  const projection = dx * normal[0] + dy * normal[1]
  if (Math.abs(projection) <= 1e-9) return null
  const signedRadius = chordSquared / (2 * projection)
  const center: Vec2 = [join[0] + normal[0] * signedRadius, join[1] + normal[1] * signedRadius]
  const radius = Math.abs(signedRadius)
  const joinAngle = angleAt(center, join)
  const endAngle = angleAt(center, end)

  // A counter-clockwise arc's tangent is the left-hand perpendicular to its
  // radius. If that points along the requested departure direction, the join
  // is the stored start; otherwise the same curve is stored from end to join.
  const ccwAtJoin: Vec2 = [-Math.sin(joinAngle), Math.cos(joinAngle)]
  if (ccwAtJoin[0] * unit[0] + ccwAtJoin[1] * unit[1] > 0) {
    return { ...normalizeArc(center, radius, joinAngle, endAngle), joinRef: 'start' }
  }
  return { ...normalizeArc(center, radius, endAngle, joinAngle), joinRef: 'end' }
}

/** A point at parameter `t`, where 0 is the start of the sweep and 1 the end. */
export function arcPointAt(arc: ArcLike, t: number): Vec2 {
  return pointOnCircle(arc.center, arc.radius, arc.startAngle + arcSweep(arc) * t)
}

export function arcStartPoint(arc: ArcLike): Vec2 {
  return arcPointAt(arc, 0)
}

export function arcEndPoint(arc: ArcLike): Vec2 {
  return arcPointAt(arc, 1)
}

/**
 * The point halfway along the arc.
 *
 * Not the midpoint of the chord, which is the mistake that matters most here:
 * fillet edge matching compares a stored mid-edge point against the real solid
 * specifically to tell a curved edge from a straight one, so handing it a chord
 * midpoint would make every arc-derived reference fail to match.
 */
export function arcMidPoint(arc: ArcLike): Vec2 {
  return arcPointAt(arc, 0.5)
}

/** Whether an absolute angle falls inside the sweep. */
export function angleWithinArc(arc: ArcLike, angle: number): boolean {
  return counterClockwiseSpan(arc.startAngle, angle) <= arcSweep(arc) + 1e-9
}

/**
 * Where a point sits along the arc, as a parameter in [0, 1], together with how
 * far it is from the curve.
 *
 * Points beyond either end measure to that endpoint rather than to the circle
 * the arc was cut from. Without that, a point out on the arc's missing
 * remainder would report as lying on the arc itself.
 */
export function locateOnArc(arc: ArcLike, point: Vec2): { t: number; distance: number } {
  const radial = Math.abs(Math.hypot(point[0] - arc.center[0], point[1] - arc.center[1]) - arc.radius)
  const span = counterClockwiseSpan(arc.startAngle, angleAt(arc.center, point))
  const sweep = arcSweep(arc)
  if (span <= sweep + 1e-9) return { t: sweep <= 1e-12 ? 0 : span / sweep, distance: radial }

  const toStart = distanceBetween(point, arcStartPoint(arc))
  const toEnd = distanceBetween(point, arcEndPoint(arc))
  return toStart <= toEnd ? { t: 0, distance: toStart } : { t: 1, distance: toEnd }
}

/** Shortest distance from a point to the arc. */
export function distanceToArc(arc: ArcLike, point: Vec2): number {
  return locateOnArc(arc, point).distance
}

/**
 * The arc's bounding box.
 *
 * Taken from the axis crossings inside the sweep rather than by sampling, so a
 * quarter-round corner reports its true extent instead of a slightly small one.
 */
export function arcBounds(arc: ArcLike): { min: Vec2; max: Vec2 } {
  const points: Vec2[] = [arcStartPoint(arc), arcEndPoint(arc)]
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const angle = (quadrant * Math.PI) / 2
    if (angleWithinArc(arc, angle)) points.push(pointOnCircle(arc.center, arc.radius, angle))
  }
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] }
}

/** Points spread along the arc, used for containment tests and tessellation. */
export function sampleArc(arc: ArcLike, count = 8): Vec2[] {
  const steps = Math.max(2, Math.ceil(count))
  const points: Vec2[] = []
  for (let index = 0; index <= steps; index += 1) points.push(arcPointAt(arc, index / steps))
  return points
}

function distanceBetween(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
