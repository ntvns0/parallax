import type { LineEntity, SketchPointRef, Vec2 } from '../core/model'

export type SketchEntitySnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'line' | 'division'

export type SketchEntitySnap = {
  point: Vec2
  kind: SketchEntitySnapKind
  /** One entity for ordinary targets, two for a line-line intersection. */
  entityIds: string[]
  /** Present when the target is an actual entity endpoint. */
  pointRef?: SketchPointRef
  /** Distance from pointRef on the target line for a measured division. */
  distance?: number
}

export type LineRulerTick = { point: Vec2; distance: number; major: boolean }

export type LineRuler = {
  lineId: string
  start: Vec2
  end: Vec2
  length: number
  datum: 'start' | 'end'
  projectedDistance: number
  activeInterval: [number, number]
  ticks: LineRulerTick[]
  snap: SketchEntitySnap | null
}

function distanceSquared(a: Vec2, b: Vec2) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function closestPointOnSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-12) return start
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
  return [start[0] + dx * t, start[1] + dy * t]
}

function projectionOnSegment(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-12) return { point: start, t: 0, length: 0 }
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
  return { point: [start[0] + dx * t, start[1] + dy * t] as Vec2, t, length: Math.sqrt(lengthSquared) }
}

function pointAtDistance(line: LineEntity, distance: number, length: number, datum: 'start' | 'end'): Vec2 {
  const fromStart = datum === 'start' ? distance : length - distance
  const t = length > 1e-12 ? fromStart / length : 0
  return [
    line.start[0] + (line.end[0] - line.start[0]) * t,
    line.start[1] + (line.end[1] - line.start[1]) * t,
  ]
}

/** Build the progressive ruler for the nearest line under the pointer. */
export function lineRulerAtPoint(
  point: Vec2,
  lines: LineEntity[],
  tolerance: number,
  tickTolerance: number,
  majorIncrement: number,
  minorIncrement: number,
  datum: 'start' | 'end' = 'start',
): LineRuler | null {
  if (tolerance <= 0 || majorIncrement <= 0 || minorIncrement <= 0) return null
  let target: { line: LineEntity; projection: ReturnType<typeof projectionOnSegment>; distance: number } | null = null
  for (const line of lines) {
    const projection = projectionOnSegment(point, line.start, line.end)
    if (projection.length < 1e-9) continue
    const candidateDistance = Math.sqrt(distanceSquared(point, projection.point))
    if (candidateDistance <= tolerance && (!target || candidateDistance < target.distance)) {
      target = { line, projection, distance: candidateDistance }
    }
  }
  if (!target) return null

  const { line, projection } = target
  const projectedDistance = datum === 'start'
    ? projection.t * projection.length
    : (1 - projection.t) * projection.length
  const intervalStart = Math.floor(projectedDistance / majorIncrement) * majorIncrement
  const activeInterval: [number, number] = [
    Math.max(0, intervalStart),
    Math.min(projection.length, intervalStart + majorIncrement),
  ]
  const tickByDistance = new Map<number, LineRulerTick>()
  const addTick = (distance: number, major: boolean) => {
    const clamped = Math.max(0, Math.min(projection.length, distance))
    const key = Math.round(clamped * 1e8) / 1e8
    const existing = tickByDistance.get(key)
    tickByDistance.set(key, {
      point: pointAtDistance(line, clamped, projection.length, datum),
      distance: clamped,
      major: major || Boolean(existing?.major),
    })
  }
  addTick(0, true)
  for (let distance = majorIncrement; distance < projection.length - 1e-9; distance += majorIncrement) addTick(distance, true)
  addTick(projection.length, true)
  const firstMinor = Math.ceil(activeInterval[0] / minorIncrement) * minorIncrement
  for (let distance = firstMinor; distance <= activeInterval[1] + 1e-9; distance += minorIncrement) addTick(distance, false)

  const ticks = [...tickByDistance.values()].sort((a, b) => a.distance - b.distance)
  let snappedTick: LineRulerTick | null = null
  let snappedDistance = tickTolerance
  for (const tick of ticks) {
    const delta = Math.abs(tick.distance - projectedDistance)
    if (delta <= snappedDistance) {
      snappedTick = tick
      snappedDistance = delta
    }
  }
  return {
    lineId: line.id,
    start: line.start,
    end: line.end,
    length: projection.length,
    datum,
    projectedDistance,
    activeInterval,
    ticks,
    snap: snappedTick ? {
      point: snappedTick.point,
      kind: 'division',
      entityIds: [line.id],
      pointRef: datum,
      distance: snappedTick.distance,
    } : null,
  }
}

/** Flip the displayed datum without waiting for another pointer movement. */
export function reverseLineRuler(ruler: LineRuler): LineRuler {
  const datum: 'start' | 'end' = ruler.datum === 'start' ? 'end' : 'start'
  const reverseSnap: SketchEntitySnap | null = ruler.snap && ruler.snap.distance !== undefined
    ? { ...ruler.snap, pointRef: datum, distance: ruler.length - ruler.snap.distance }
    : ruler.snap
  return {
    ...ruler,
    datum,
    projectedDistance: ruler.length - ruler.projectedDistance,
    activeInterval: [ruler.length - ruler.activeInterval[1], ruler.length - ruler.activeInterval[0]],
    ticks: ruler.ticks.map((tick) => ({ ...tick, distance: ruler.length - tick.distance })).sort((a, b) => a.distance - b.distance),
    snap: reverseSnap,
  }
}

/** The intersection of two finite line segments, including their ends. */
function segmentIntersection(first: LineEntity, second: LineEntity): Vec2 | null {
  const ax = first.end[0] - first.start[0]
  const ay = first.end[1] - first.start[1]
  const bx = second.end[0] - second.start[0]
  const by = second.end[1] - second.start[1]
  const denominator = ax * by - ay * bx
  if (Math.abs(denominator) < 1e-12) return null
  const dx = second.start[0] - first.start[0]
  const dy = second.start[1] - first.start[1]
  const firstT = (dx * by - dy * bx) / denominator
  const secondT = (dx * ay - dy * ax) / denominator
  const epsilon = 1e-9
  if (firstT < -epsilon || firstT > 1 + epsilon || secondT < -epsilon || secondT > 1 + epsilon) return null
  return [first.start[0] + firstT * ax, first.start[1] + firstT * ay]
}

function nearest(point: Vec2, candidates: SketchEntitySnap[], tolerance: number): SketchEntitySnap | null {
  let best: SketchEntitySnap | null = null
  let bestDistance = tolerance * tolerance
  for (const candidate of candidates) {
    const candidateDistance = distanceSquared(point, candidate.point)
    if (candidateDistance <= bestDistance) {
      best = candidate
      bestDistance = candidateDistance
    }
  }
  return best
}

/**
 * Find the most useful location on existing sketch lines.
 *
 * Discrete design-intent targets win over a generic projection even when the
 * projection is a little closer. This makes endpoints, crossings and midpoints
 * easy to acquire instead of requiring pixel-perfect pointer placement.
 */
export function snapToSketchLines(point: Vec2, lines: LineEntity[], tolerance: number): SketchEntitySnap | null {
  if (tolerance <= 0 || !lines.length) return null

  const endpoints: SketchEntitySnap[] = lines.flatMap((line) => [
    { point: line.start, kind: 'endpoint', entityIds: [line.id], pointRef: 'start' },
    { point: line.end, kind: 'endpoint', entityIds: [line.id], pointRef: 'end' },
  ])
  const endpoint = nearest(point, endpoints, tolerance)
  if (endpoint) return endpoint

  const intersections: SketchEntitySnap[] = []
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const intersection = segmentIntersection(lines[first], lines[second])
      if (intersection) intersections.push({
        point: intersection,
        kind: 'intersection',
        entityIds: [lines[first].id, lines[second].id],
      })
    }
  }
  const intersection = nearest(point, intersections, tolerance)
  if (intersection) return intersection

  const midpoints: SketchEntitySnap[] = lines.map((line) => ({
    point: [(line.start[0] + line.end[0]) / 2, (line.start[1] + line.end[1]) / 2],
    kind: 'midpoint',
    entityIds: [line.id],
  }))
  const midpoint = nearest(point, midpoints, tolerance)
  if (midpoint) return midpoint

  return nearest(point, lines.map((line) => ({
    point: closestPointOnSegment(point, line.start, line.end),
    kind: 'line',
    entityIds: [line.id],
  })), tolerance)
}
