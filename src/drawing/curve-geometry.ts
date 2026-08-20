import type { Bounds2, Point2, ProjectedCurve } from './drawing-types'

export const TAU = Math.PI * 2

/**
 * Coincidence tolerance in millimetres.
 *
 * Deliberately loose compared with kernel precision: the only judgement it
 * makes is "are these two curves drawn on top of each other", and two curves a
 * micron apart are indistinguishable in ink no matter how exact the B-rep is.
 */
export const COINCIDENT_TOLERANCE = 1e-3

export function subtract(a: Point2, b: Point2): Point2 {
  return [a[0] - b[0], a[1] - b[1]]
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
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

export function angleAt(center: Point2, point: Point2): number {
  return Math.atan2(point[1] - center[1], point[0] - center[0])
}

export function pointOnCircle(center: Point2, radius: number, angle: number): Point2 {
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
}

/**
 * The circle through three points, or null when they are collinear.
 *
 * The kernel hands back arcs as parametric curves we cannot inspect directly,
 * so the centre and radius are recovered from three sampled points instead.
 * That is exact for a true circle and simply fails — rather than inventing a
 * huge radius — when the samples turn out to lie on a line.
 */
export function circleThroughPoints(a: Point2, b: Point2, c: Point2): { center: Point2; radius: number } | null {
  const [ax, ay] = a
  const [bx, by] = b
  const [cx, cy] = c
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-12) return null

  const aSquared = ax * ax + ay * ay
  const bSquared = bx * bx + by * by
  const cSquared = cx * cx + cy * cy
  const center: Point2 = [
    (aSquared * (by - cy) + bSquared * (cy - ay) + cSquared * (ay - by)) / d,
    (aSquared * (cx - bx) + bSquared * (ax - cx) + cSquared * (bx - ax)) / d,
  ]
  const radius = distance(center, a)
  if (!Number.isFinite(radius) || radius <= 0) return null
  return { center, radius }
}

/**
 * Build an arc that starts at `start`, ends at `end` and passes through `mid`.
 *
 * Arcs are always stored sweeping counter-clockwise, so the renderers never
 * have to carry a direction flag. When the natural sweep runs clockwise the
 * endpoints are exchanged, which describes the same set of points.
 */
export function arcThroughPoints(start: Point2, mid: Point2, end: Point2): ProjectedCurve | null {
  const circle = circleThroughPoints(start, mid, end)
  if (!circle) return null
  const { center, radius } = circle

  const startAngle = angleAt(center, start)
  const midAngle = angleAt(center, mid)
  const endAngle = angleAt(center, end)

  const forwardSweep = counterClockwiseSpan(startAngle, endAngle)
  const midSweep = counterClockwiseSpan(startAngle, midAngle)

  // A full circle arrives as start === end; the mid point then tells us nothing
  // about direction, and the whole circle is the only sensible reading.
  if (forwardSweep < 1e-9 && midSweep > 1e-9) {
    return { type: 'circle', center, radius }
  }

  if (midSweep <= forwardSweep) {
    return { type: 'arc', center, radius, startAngle, endAngle: startAngle + forwardSweep }
  }
  const backwardSweep = counterClockwiseSpan(endAngle, startAngle)
  return { type: 'arc', center, radius, startAngle: endAngle, endAngle: endAngle + backwardSweep }
}

export function arcSweep(curve: Extract<ProjectedCurve, { type: 'arc' }>): number {
  return curve.endAngle - curve.startAngle
}

function mergeAngularIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], interval[1])
    else merged.push([...interval])
  }
  return merged
}

/** Total angle covered by a set of arcs on the same circle, counting overlap once. */
export function angularCoverage(arcs: Extract<ProjectedCurve, { type: 'arc' }>[]): number {
  const intervals: [number, number][] = []
  for (const arc of arcs) {
    const start = normalizeAngle(arc.startAngle)
    const sweep = Math.min(arcSweep(arc), TAU)
    if (start + sweep <= TAU) intervals.push([start, start + sweep])
    else {
      intervals.push([start, TAU])
      intervals.push([0, start + sweep - TAU])
    }
  }
  return mergeAngularIntervals(intervals).reduce((total, [start, end]) => total + (end - start), 0)
}

function circleKey(center: Point2, radius: number): string {
  const round = (value: number) => Math.round(value / COINCIDENT_TOLERANCE)
  return `${round(center[0])},${round(center[1])},${round(radius)}`
}

/**
 * Rejoin arcs that together make a whole circle.
 *
 * Hidden-line removal splits every circular edge at its silhouette points, so a
 * plain hole always arrives as two half-arcs. Putting them back together is
 * what lets the annotator recognise a hole and call out its diameter, and it
 * removes the hairline seam those two arcs otherwise leave in the print.
 */
export function mergeArcsIntoCircles(curves: ProjectedCurve[]): ProjectedCurve[] {
  const groups = new Map<string, Extract<ProjectedCurve, { type: 'arc' }>[]>()
  for (const curve of curves) {
    if (curve.type !== 'arc') continue
    const key = circleKey(curve.center, curve.radius)
    const group = groups.get(key)
    if (group) group.push(curve)
    else groups.set(key, [curve])
  }

  const completed = new Set<string>()
  const circles: ProjectedCurve[] = []
  for (const [key, group] of groups) {
    if (angularCoverage(group) < TAU - 1e-6) continue
    completed.add(key)
    circles.push({ type: 'circle', center: group[0].center, radius: group[0].radius })
  }

  const kept = curves.filter((curve) => curve.type !== 'arc' || !completed.has(circleKey(curve.center, curve.radius)))
  return [...kept, ...circles]
}

function distanceToSegment(point: Point2, start: Point2, end: Point2): number {
  const span = subtract(end, start)
  const lengthSquared = span[0] * span[0] + span[1] * span[1]
  if (lengthSquared < 1e-18) return distance(point, start)
  const offset = subtract(point, start)
  const t = Math.max(0, Math.min(1, (offset[0] * span[0] + offset[1] * span[1]) / lengthSquared))
  return distance(point, [start[0] + span[0] * t, start[1] + span[1] * t])
}

/** Shortest distance from a point to a curve. Used only for coincidence tests. */
export function distanceToCurve(point: Point2, curve: ProjectedCurve): number {
  if (curve.type === 'segment') return distanceToSegment(point, curve.start, curve.end)
  if (curve.type === 'polyline') {
    let closest = Infinity
    for (let index = 1; index < curve.points.length; index += 1) {
      closest = Math.min(closest, distanceToSegment(point, curve.points[index - 1], curve.points[index]))
    }
    return curve.points.length === 1 ? distance(point, curve.points[0]) : closest
  }
  const radial = Math.abs(distance(point, curve.center) - curve.radius)
  if (curve.type === 'circle') return radial
  const within = counterClockwiseSpan(curve.startAngle, angleAt(curve.center, point)) <= arcSweep(curve) + 1e-9
  if (within) return radial
  return Math.min(
    distance(point, pointOnCircle(curve.center, curve.radius, curve.startAngle)),
    distance(point, pointOnCircle(curve.center, curve.radius, curve.endAngle)),
  )
}

/** Points spread along a curve, used to decide whether it lies on another one. */
export function sampleCurve(curve: ProjectedCurve, count = 7): Point2[] {
  if (curve.type === 'segment') {
    return Array.from({ length: count }, (_, index) => {
      const t = index / (count - 1)
      return [
        curve.start[0] + (curve.end[0] - curve.start[0]) * t,
        curve.start[1] + (curve.end[1] - curve.start[1]) * t,
      ] as Point2
    })
  }
  if (curve.type === 'polyline') {
    if (curve.points.length <= count) return curve.points
    return Array.from({ length: count }, (_, index) =>
      curve.points[Math.round((index / (count - 1)) * (curve.points.length - 1))])
  }
  const start = curve.type === 'circle' ? 0 : curve.startAngle
  const sweep = curve.type === 'circle' ? TAU : arcSweep(curve)
  return Array.from({ length: count }, (_, index) =>
    pointOnCircle(curve.center, curve.radius, start + (sweep * index) / (count - 1)))
}

function liesOnAny(curve: ProjectedCurve, others: ProjectedCurve[], tolerance: number): boolean {
  const samples = sampleCurve(curve)
  return samples.every((sample) => others.some((other) => distanceToCurve(sample, other) <= tolerance))
}

/**
 * Drop curves that are already drawn by an earlier curve in the same list.
 *
 * Projection routinely emits the same edge twice — once for each of the two
 * faces that meet along it — and doubled strokes print heavier than their
 * neighbours.
 */
export function dedupeCurves(curves: ProjectedCurve[], tolerance = COINCIDENT_TOLERANCE): ProjectedCurve[] {
  const kept: ProjectedCurve[] = []
  for (const curve of curves) {
    if (!liesOnAny(curve, kept, tolerance)) kept.push(curve)
  }
  return kept
}

/**
 * Remove hidden curves that a visible curve already covers.
 *
 * Every back face of a part projects onto its front face, so without this the
 * outline of a simple block is drawn dashed on top of solid — the convention
 * says visible always wins, and the dashes only add noise.
 *
 * Suppression is all-or-nothing per curve. A hidden curve that is only
 * partially covered stays whole, which errs towards showing internal geometry
 * rather than silently deleting it.
 */
export function suppressCoveredCurves(
  hidden: ProjectedCurve[],
  visible: ProjectedCurve[],
  tolerance = COINCIDENT_TOLERANCE,
): ProjectedCurve[] {
  return dedupeCurves(hidden, tolerance).filter((curve) => !liesOnAny(curve, visible, tolerance))
}

function extendBounds(bounds: Bounds2 | null, point: Point2): Bounds2 {
  if (!bounds) return { min: [...point] as Point2, max: [...point] as Point2 }
  return {
    min: [Math.min(bounds.min[0], point[0]), Math.min(bounds.min[1], point[1])],
    max: [Math.max(bounds.max[0], point[0]), Math.max(bounds.max[1], point[1])],
  }
}

/**
 * The exact extent of one curve.
 *
 * Arc extents come from the axis crossings inside the sweep rather than from
 * sampling, because the overall dimensions printed on the sheet are read
 * straight off these numbers and a sampled bound would quietly under-report a
 * filleted corner.
 */
export function curveBounds(curve: ProjectedCurve): Bounds2 | null {
  if (curve.type === 'segment') return extendBounds(extendBounds(null, curve.start), curve.end)
  if (curve.type === 'polyline') return curve.points.reduce<Bounds2 | null>(extendBounds, null)
  if (curve.type === 'circle') {
    return {
      min: [curve.center[0] - curve.radius, curve.center[1] - curve.radius],
      max: [curve.center[0] + curve.radius, curve.center[1] + curve.radius],
    }
  }
  let bounds = extendBounds(null, pointOnCircle(curve.center, curve.radius, curve.startAngle))
  bounds = extendBounds(bounds, pointOnCircle(curve.center, curve.radius, curve.endAngle))
  const sweep = arcSweep(curve)
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const angle = (quadrant * Math.PI) / 2
    if (counterClockwiseSpan(curve.startAngle, angle) <= sweep + 1e-9) {
      bounds = extendBounds(bounds, pointOnCircle(curve.center, curve.radius, angle))
    }
  }
  return bounds
}

export function combineBounds(a: Bounds2 | null, b: Bounds2 | null): Bounds2 | null {
  if (!a) return b
  if (!b) return a
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  }
}

export function curvesBounds(curves: ProjectedCurve[]): Bounds2 | null {
  return curves.reduce<Bounds2 | null>((bounds, curve) => combineBounds(bounds, curveBounds(curve)), null)
}

export function boundsSize(bounds: Bounds2): Point2 {
  return [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]]
}

export function boundsCenter(bounds: Bounds2): Point2 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2]
}
