import {
  angleAt,
  arcBounds,
  arcEndPoint,
  arcStartPoint,
  normalizeArc,
  pointOnCircle,
  sampleArc,
} from './arc-geometry'
import type { ArcEntity, CircleEntity, LineEntity, SketchAnchor, SketchEntity, SketchFeature, Vec2 } from './model'

/**
 * One edge of a closed boundary, in the direction the boundary is traced.
 *
 * An arc is stored counter-clockwise, but a loop may need to run through it the
 * other way, so the direction it is *travelled* is recorded here rather than
 * inferred from the entity.
 */
export type PathSegment =
  | { kind: 'line'; start: Vec2; end: Vec2 }
  | { kind: 'arc'; start: Vec2; end: Vec2; center: Vec2; radius: number; clockwise: boolean }

/**
 * A closed boundary.
 *
 * `polygon` is kept alongside `path` rather than replaced by it so that a
 * sketch made only of lines serializes exactly as it always did. That matters
 * because this structure is both what crosses the worker boundary and what the
 * exact-evaluation cache is keyed on: promoting every existing profile to a
 * path would invalidate every cached solid for no change in geometry.
 */
export type ClosedProfile =
  | { type: 'polygon'; points: Vec2[] }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'path'; segments: PathSegment[] }

/**
 * One extrudable face: an outer boundary and the profiles that punch through
 * it. A sketch containing a rectangle with two circles inside it produces a
 * single region with two holes, not three separate solids.
 */
export type ProfileRegion = {
  outer: ClosedProfile
  holes: ClosedProfile[]
}

const PROFILE_TOLERANCE = 1e-5
const CONTAINMENT_SAMPLES = 12

function samePoint(a: Vec2, b: Vec2, tolerance = PROFILE_TOLERANCE) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance
}

/** An entity that can form part of a boundary: everything but a full circle. */
type EdgeEntity = LineEntity | ArcEntity

/** The two ends of an edge, in the entity's own stored direction. */
function edgeEndpoints(entity: EdgeEntity): [Vec2, Vec2] {
  return entity.type === 'line' ? [entity.start, entity.end] : [arcStartPoint(entity), arcEndPoint(entity)]
}

/**
 * Trace one edge starting from `from`, returning the segment travelled and the
 * point it leaves you at, or null when `from` is not an end of this edge.
 */
function traceEdge(entity: EdgeEntity, from: Vec2): { segment: PathSegment; to: Vec2 } | null {
  const [head, tail] = edgeEndpoints(entity)
  const forward = samePoint(head, from)
  if (!forward && !samePoint(tail, from)) return null
  const to = forward ? tail : head

  if (entity.type === 'line') return { segment: { kind: 'line', start: from, end: to }, to }
  return {
    segment: {
      kind: 'arc',
      start: from,
      end: to,
      center: entity.center,
      radius: entity.radius,
      // Stored arcs sweep counter-clockwise, so running one backwards is the
      // only way a boundary travels an arc clockwise.
      clockwise: !forward,
    },
    to,
  }
}

type SplitLine = { start: Vec2; end: Vec2 }

/** Parameters where two finite, non-collinear segments meet. */
function lineIntersectionParameters(first: LineEntity, second: LineEntity): [number, number] | null {
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
  return [Math.max(0, Math.min(1, firstT)), Math.max(0, Math.min(1, secondT))]
}

/**
 * Split lines wherever another line crosses or terminates on them.
 *
 * Sketch constraints do not physically cut a line at a point-on-line join,
 * but profile topology must treat that join as a vertex. Without these
 * implicit pieces a rectangle divided down the middle still looks like one
 * loop plus an unrelated open line.
 */
function splitAtLineIntersections(lines: LineEntity[]): SplitLine[] {
  const parameters = lines.map(() => [0, 1])
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const intersection = lineIntersectionParameters(lines[first], lines[second])
      if (!intersection) continue
      parameters[first].push(intersection[0])
      parameters[second].push(intersection[1])
    }
  }

  return lines.flatMap((line, index) => {
    const dx = line.end[0] - line.start[0]
    const dy = line.end[1] - line.start[1]
    const sorted = [...parameters[index]]
      .sort((a, b) => a - b)
      .filter((value, position, values) => position === 0 || Math.abs(value - values[position - 1]) > 1e-9)
    const pieces: SplitLine[] = []
    for (let position = 1; position < sorted.length; position += 1) {
      const from = sorted[position - 1]
      const to = sorted[position]
      if (to - from < 1e-9) continue
      pieces.push({
        start: [line.start[0] + dx * from, line.start[1] + dy * from],
        end: [line.start[0] + dx * to, line.start[1] + dy * to],
      })
    }
    return pieces
  })
}

function polygonSignedArea(points: Vec2[]) {
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    twiceArea += points[index][0] * next[1] - next[0] * points[index][1]
  }
  return twiceArea / 2
}

/**
 * Trace every bounded face in a straight-line planar graph.
 *
 * Each physical segment owns two directed half-edges, so a shared wall can
 * bound the face on either side. Walking the next clockwise edge at every
 * vertex keeps the current face on the left; positive-area walks are the
 * bounded faces and the clockwise exterior is discarded.
 */
function getLineFaces(lines: LineEntity[]): ClosedProfile[] {
  const vertices: Vec2[] = []
  const vertexIndex = (point: Vec2) => {
    const existing = vertices.findIndex((candidate) => samePoint(candidate, point))
    if (existing >= 0) return existing
    vertices.push(point)
    return vertices.length - 1
  }
  const halfEdges: { from: number; to: number; twin: number; used: boolean }[] = []
  const outgoing: number[][] = []

  for (const piece of splitAtLineIntersections(lines)) {
    const from = vertexIndex(piece.start)
    const to = vertexIndex(piece.end)
    if (from === to) continue
    while (outgoing.length < vertices.length) outgoing.push([])
    const forward = halfEdges.length
    const reverse = forward + 1
    halfEdges.push(
      { from, to, twin: reverse, used: false },
      { from: to, to: from, twin: forward, used: false },
    )
    outgoing[from].push(forward)
    outgoing[to].push(reverse)
  }

  for (const edges of outgoing) {
    edges.sort((first, second) => {
      const a = halfEdges[first]
      const b = halfEdges[second]
      return Math.atan2(vertices[a.to][1] - vertices[a.from][1], vertices[a.to][0] - vertices[a.from][0])
        - Math.atan2(vertices[b.to][1] - vertices[b.from][1], vertices[b.to][0] - vertices[b.from][0])
    })
  }

  const profiles: ClosedProfile[] = []
  for (let opening = 0; opening < halfEdges.length; opening += 1) {
    if (halfEdges[opening].used) continue
    const points: Vec2[] = []
    let current = opening
    let closed = false
    for (let safety = 0; safety <= halfEdges.length; safety += 1) {
      const edge = halfEdges[current]
      if (edge.used) {
        closed = current === opening
        break
      }
      edge.used = true
      points.push(vertices[edge.from])
      const choices = outgoing[edge.to]
      const reverseIndex = choices.indexOf(edge.twin)
      current = choices[(reverseIndex + choices.length - 1) % choices.length]
      if (current === opening) {
        closed = true
        break
      }
    }
    if (closed && points.length >= 3 && polygonSignedArea(points) > PROFILE_TOLERANCE) {
      profiles.push({ type: 'polygon', points })
    }
  }
  return profiles
}

/**
 * Every closed boundary in a sketch.
 *
 * Full circles stand alone. Everything else is found by walking edges end to
 * end until the walk returns to where it started.
 */
export function getClosedProfiles(sketch: SketchFeature): ClosedProfile[] {
  const profiles: ClosedProfile[] = sketch.entities
    .filter((entity): entity is CircleEntity => entity.type === 'circle' && !entity.construction && entity.radius > 0)
    .map((entity) => ({ type: 'circle', center: entity.center, radius: entity.radius }))

  const edges = sketch.entities.filter((entity): entity is EdgeEntity =>
    (entity.type === 'line' || entity.type === 'arc') && !entity.construction)
  if (edges.every((entity): entity is LineEntity => entity.type === 'line')) {
    profiles.push(...getLineFaces(edges))
    return profiles
  }
  const unused = new Set(edges.map((edge) => edge.id))

  while (unused.size) {
    const firstId = unused.values().next().value as string
    const first = edges.find((edge) => edge.id === firstId)!
    unused.delete(firstId)

    const [origin] = edgeEndpoints(first)
    const opening = traceEdge(first, origin)!
    const segments: PathSegment[] = [opening.segment]
    let cursor = opening.to
    let safety = edges.length + 1

    while (safety-- > 0 && !samePoint(cursor, origin)) {
      let advanced: { segment: PathSegment; to: Vec2 } | null = null
      for (const candidate of edges) {
        if (!unused.has(candidate.id)) continue
        const step = traceEdge(candidate, cursor)
        if (!step) continue
        unused.delete(candidate.id)
        advanced = step
        break
      }
      if (!advanced) break
      segments.push(advanced.segment)
      cursor = advanced.to
    }

    if (!samePoint(cursor, origin)) continue
    // Three straight edges are the fewest that can enclose area, but one arc is
    // enough on its own: a line closed by an arc is a D, and two arcs make a
    // lens. Requiring three segments unconditionally would reject both.
    const curved = segments.some((segment) => segment.kind === 'arc')
    if (!curved && segments.length < 3) continue

    profiles.push(curved
      ? { type: 'path', segments }
      : { type: 'polygon', points: segments.map((segment) => segment.start) })
  }
  return profiles
}

/**
 * A closed profile as a ring of points, curves tessellated.
 *
 * Used for containment and bounds, where an approximation is safe. Anything
 * that reaches the kernel or a drawing keeps the exact form instead.
 */
export function profileOutline(profile: ClosedProfile, arcSamples = 16): Vec2[] {
  if (profile.type === 'polygon') return profile.points
  if (profile.type === 'circle') {
    const points: Vec2[] = []
    for (let index = 0; index < arcSamples * 2; index += 1) {
      points.push(pointOnCircle(profile.center, profile.radius, (index / (arcSamples * 2)) * Math.PI * 2))
    }
    return points
  }
  const points: Vec2[] = []
  for (const segment of profile.segments) {
    if (segment.kind === 'line') {
      points.push(segment.start)
      continue
    }
    // sampleArc runs counter-clockwise; a segment travelled the other way needs
    // its samples reversed or the ring doubles back on itself.
    const samples = sampleArc(arcAlong(segment), arcSamples)
    const travelled = segment.clockwise ? samples.reverse() : samples
    // Drop the final sample: it is the next segment's start point.
    points.push(...travelled.slice(0, -1))
  }
  return points
}

/** The arc a path segment travels, in the counter-clockwise stored form. */
export function arcAlong(segment: Extract<PathSegment, { kind: 'arc' }>) {
  const from = angleAt(segment.center, segment.start)
  const to = angleAt(segment.center, segment.end)
  return segment.clockwise
    ? normalizeArc(segment.center, segment.radius, to, from)
    : normalizeArc(segment.center, segment.radius, from, to)
}

function anchorForEntity(entity: SketchEntity): SketchAnchor {
  return { entityId: entity.id, point: entity.type === 'line' ? 'start' : 'center' }
}

/** The point an anchor pins, for any entity kind. */
function anchoredPoint(entity: SketchEntity, point: SketchAnchor['point']): Vec2 {
  if (entity.type === 'circle') return entity.center
  if (entity.type === 'arc') return point === 'center' ? entity.center : arcStartPoint(entity)
  return point === 'start' ? entity.start : entity.end
}

/**
 * The anchor a sketch should solve against, preferring the recorded one and
 * falling back to the oldest surviving entity when that geometry is gone.
 * Returns undefined for an empty sketch, which has nothing to hold still.
 */
export function resolveSketchAnchor(entities: SketchEntity[], anchor: SketchAnchor | undefined): SketchAnchor | undefined {
  if (anchor && entities.some((entity) => entity.id === anchor.entityId)) return anchor
  return entities.length ? anchorForEntity(entities[0]) : undefined
}

/** The world position the anchor pins, used to keep translations from snapping back. */
export function sketchAnchorPoint(entities: SketchEntity[], anchor: SketchAnchor | undefined): Vec2 | null {
  const entity = anchor && entities.find((candidate) => candidate.id === anchor.entityId)
  if (!entity) return null
  return anchoredPoint(entity, anchor.point)
}

function profileSamplePoints(profile: ClosedProfile): Vec2[] {
  if (profile.type === 'polygon') return profile.points
  if (profile.type === 'path') return profileOutline(profile, CONTAINMENT_SAMPLES)
  const points: Vec2[] = [profile.center]
  for (let index = 0; index < CONTAINMENT_SAMPLES; index += 1) {
    const angle = (index / CONTAINMENT_SAMPLES) * Math.PI * 2
    points.push([
      profile.center[0] + Math.cos(angle) * profile.radius,
      profile.center[1] + Math.sin(angle) * profile.radius,
    ])
  }
  return points
}

function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [startX, startY] = polygon[previous]
    const [endX, endY] = polygon[index]
    const straddlesRay = startY > point[1] !== endY > point[1]
    if (straddlesRay && point[0] < ((endX - startX) * (point[1] - startY)) / (endY - startY) + startX) {
      inside = !inside
    }
  }
  return inside
}

export function pointInProfile(point: Vec2, profile: ClosedProfile) {
  if (profile.type === 'circle') {
    return Math.hypot(point[0] - profile.center[0], point[1] - profile.center[1]) <= profile.radius
  }
  return pointInPolygon(point, profileOutline(profile))
}

/**
 * A profile is inside another when every one of its sample points is. Sampling
 * rather than testing a single representative point keeps concave boundaries
 * honest: a centroid can easily fall outside its own polygon.
 */
function containsProfile(outer: ClosedProfile, inner: ClosedProfile) {
  if (outer === inner) return false
  return profileSamplePoints(inner).every((point) => pointInProfile(point, outer))
}

/**
 * Group a sketch's closed profiles into extrudable regions using the even-odd
 * rule: a profile nested an even number of deep is material, an odd number is a
 * hole in its immediate parent. This is what lets a rectangle with an inner
 * circle extrude as a plate with a hole rather than as a plain plate.
 */
export function getProfileRegions(sketch: SketchFeature): ProfileRegion[] {
  const profiles = getClosedProfiles(sketch)
  const depths = profiles.map((profile) => profiles.filter((candidate) => containsProfile(candidate, profile)).length)

  const regions: ProfileRegion[] = []
  const regionByProfileIndex = new Map<number, number>()
  profiles.forEach((profile, index) => {
    if (depths[index] % 2 !== 0) return
    regionByProfileIndex.set(index, regions.length)
    regions.push({ outer: profile, holes: [] })
  })

  profiles.forEach((profile, index) => {
    if (depths[index] % 2 === 0) return
    // The immediate parent is the most deeply nested profile that contains
    // this one, which is always at the next depth up and therefore a region.
    let parent = -1
    profiles.forEach((candidate, candidateIndex) => {
      if (!containsProfile(candidate, profile)) return
      if (parent < 0 || depths[candidateIndex] > depths[parent]) parent = candidateIndex
    })
    const region = parent >= 0 ? regionByProfileIndex.get(parent) : undefined
    if (region !== undefined) regions[region].holes.push(profile)
  })

  return regions
}

export function sketchBounds(entities: SketchEntity[]) {
  const points: Vec2[] = []
  for (const entity of entities) {
    if (entity.type === 'line') points.push(entity.start, entity.end)
    // An arc reaches its full radius only where it crosses an axis, so its box
    // is usually smaller than the circle it was cut from.
    else if (entity.type === 'arc') {
      const box = arcBounds(entity)
      points.push(box.min, box.max)
    }
    else points.push(
      [entity.center[0] - entity.radius, entity.center[1] - entity.radius],
      [entity.center[0] + entity.radius, entity.center[1] + entity.radius],
    )
  }
  if (!points.length) return { min: [0, 0] as Vec2, max: [0, 0] as Vec2, width: 0, height: 0 }
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const min: Vec2 = [Math.min(...xs), Math.min(...ys)]
  const max: Vec2 = [Math.max(...xs), Math.max(...ys)]
  return { min, max, width: max[0] - min[0], height: max[1] - min[1] }
}

export function scaleSketchEntities(entities: SketchEntity[], axis: 0 | 1, targetSize: number): SketchEntity[] {
  if (entities.length === 1 && entities[0].type === 'circle') {
    return [{ ...entities[0], radius: targetSize / 2 }]
  }
  const bounds = sketchBounds(entities)
  const currentSize = axis === 0 ? bounds.width : bounds.height
  if (currentSize <= 1e-9) return entities
  const center = (bounds.min[axis] + bounds.max[axis]) / 2
  const ratio = targetSize / currentSize
  const scalePoint = (point: Vec2): Vec2 => {
    const result: Vec2 = [...point]
    result[axis] = center + (point[axis] - center) * ratio
    return result
  }
  // Circles and arcs move by their centre and keep their radius: scaling one
  // axis of a round entity would make an ellipse, which this model cannot hold.
  // An arc's angles survive the move untouched.
  return entities.map((entity) => entity.type === 'line'
    ? { ...entity, start: scalePoint(entity.start), end: scalePoint(entity.end) }
    : { ...entity, center: scalePoint(entity.center), radius: entity.radius * (axis === 0 && bounds.height === 0 ? ratio : 1) })
}

export function connectedSketchEntityIds(sketch: SketchFeature, rootId: string) {
  const connected = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const constraint of sketch.constraints) {
      if (constraint.type !== 'coincident' || !constraint.entityIds.some((id) => connected.has(id))) continue
      for (const id of constraint.entityIds) {
        if (!connected.has(id)) {
          connected.add(id)
          changed = true
        }
      }
    }
  }
  return connected
}

export function translateSketchEntities(entities: SketchEntity[], entityIds: Set<string>, delta: Vec2): SketchEntity[] {
  const translatePoint = (point: Vec2): Vec2 => [point[0] + delta[0], point[1] + delta[1]]
  return entities.map((entity) => {
    if (!entityIds.has(entity.id)) return entity
    // Circles and arcs both move by their centre; an arc's angles describe a
    // direction, which translation leaves alone.
    return entity.type === 'line'
      ? { ...entity, start: translatePoint(entity.start), end: translatePoint(entity.end) }
      : { ...entity, center: translatePoint(entity.center) }
  })
}

export function sketchEntitySelectionCenter(entities: SketchEntity[], entityIds: Set<string>): Vec2 {
  const selected = entities.filter((entity) => entityIds.has(entity.id))
  const bounds = sketchBounds(selected)
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2]
}

export function positionSketchEntities(entities: SketchEntity[], entityIds: Set<string>, center: Vec2): SketchEntity[] {
  if (!entities.some((entity) => entityIds.has(entity.id))) return entities
  const current = sketchEntitySelectionCenter(entities, entityIds)
  return translateSketchEntities(entities, entityIds, [center[0] - current[0], center[1] - current[1]])
}
