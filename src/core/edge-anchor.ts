import { arcEndPoint, arcMidPoint, arcPointAt, arcStartPoint, locateOnArc } from './arc-geometry'
import { extrudeSweepRange } from './extrude-direction'
import { currentPlaneOffset } from './face-anchor'
import type { EdgeAnchor, ExtrudeFeature, Feature, FilletEdgeReference, RevolveFeature, SketchEntity, SketchFeature, Vec2, Vec3 } from './model'
import { axialPosition, revolveAxis, rotateAboutAxis } from './revolve-axis'
import { projectToSketchPlane, sketchPlaneOffset, sketchPointToWorld } from './sketch-plane'
import { ANCHOR_MATCH_DISTANCE_MM } from './tolerance-policy'

/**
 * Anchoring an edge to the sketch geometry that swept it.
 *
 * Extruding a closed profile makes exactly two kinds of edge. The profile curve
 * appears at each end of the sweep — the rim of a pocket, the top and bottom of
 * a boss — and every point on the profile drags a corner along the sweep
 * direction. Naming an edge by which entity produced it and where means the
 * reference follows that entity when the design changes, because sketch entity
 * ids survive moves, resizes and solver runs.
 *
 * Both directions are pure functions of the document. Deriving needs no solid,
 * only the stored coordinates and the profiles, which is what lets saved parts
 * gain anchors in a migration rather than having to be rebuilt first.
 */

function distance2(a: readonly number[], b: readonly number[]) {
  return Math.hypot(...a.map((value, index) => value - b[index]))
}

/** Every extrusion in the document paired with the sketch it was built from. */
function extrusions(features: Feature[]): { extrude: ExtrudeFeature; sketch: SketchFeature }[] {
  const found: { extrude: ExtrudeFeature; sketch: SketchFeature }[] = []
  for (const feature of features) {
    if (feature.kind !== 'extrude') continue
    const source = features.find((candidate) => candidate.id === feature.sketchId)
    if (source?.kind === 'sketch') found.push({ extrude: feature, sketch: source })
  }
  return found
}

/** Every revolve in the document paired with the sketch it was built from. */
function revolutions(features: Feature[]): { revolve: RevolveFeature; sketch: SketchFeature }[] {
  const found: { revolve: RevolveFeature; sketch: SketchFeature }[] = []
  for (const feature of features) {
    if (feature.kind !== 'revolve') continue
    const source = features.find((candidate) => candidate.id === feature.sketchId)
    if (source?.kind === 'sketch') found.push({ revolve: feature, sketch: source })
  }
  return found
}

/** An entity's two ends, or none for a circle, which has no vertex to sweep. */
function entityEnds(entity: SketchEntity): [Vec2, Vec2] | null {
  if (entity.type === 'circle') return null
  return entity.type === 'arc' ? [arcStartPoint(entity), arcEndPoint(entity)] : [entity.start, entity.end]
}

/** Where on an entity a point sits, and how far it is from the curve. */
function locateOnEntity(entity: SketchEntity, point: Vec2): { t: number; distance: number } | null {
  if (entity.type === 'circle') {
    if (entity.radius <= 0) return null
    const dx = point[0] - entity.center[0]
    const dy = point[1] - entity.center[1]
    const radius = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)
    return { t: (angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2), distance: Math.abs(radius - entity.radius) }
  }
  if (entity.type === 'arc') {
    if (entity.radius <= 0) return null
    // Measured against the arc, not the circle it was cut from: a point out on
    // the missing remainder is far away, not sitting on the curve.
    return locateOnArc(entity, point)
  }
  const dx = entity.end[0] - entity.start[0]
  const dy = entity.end[1] - entity.start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-12) return null
  const raw = ((point[0] - entity.start[0]) * dx + (point[1] - entity.start[1]) * dy) / lengthSquared
  const t = Math.max(0, Math.min(1, raw))
  const closest: Vec2 = [entity.start[0] + dx * t, entity.start[1] + dy * t]
  return { t, distance: distance2(point, closest) }
}

/**
 * Where on an entity a corner sits, or null if this entity has no corner there.
 *
 * Only a *vertex* of the profile drags an edge along the sweep. A point partway
 * along a straight segment sweeps a face, not an edge, so an edge found there
 * was made by something else — the tangent boundary of a fillet, typically,
 * which runs along the wall parallel to the profile and would otherwise be
 * mistaken for the profile itself.
 *
 * A circle has no vertices; its extrusion carries a seam edge instead, which
 * the kernel may place at any parameter, so any position on it is legitimate.
 */
function lateralParameter(entity: SketchEntity, point: Vec2): number | null {
  if (entity.type === 'circle') {
    const located = locateOnEntity(entity, point)
    return located && located.distance <= ANCHOR_MATCH_DISTANCE_MM ? located.t : null
  }
  // An arc goes with the line, not the circle: it has two genuine ends, each of
  // which drags an edge along the sweep, and no seam anywhere in between.
  const [head, tail] = entity.type === 'arc'
    ? [arcStartPoint(entity), arcEndPoint(entity)]
    : [entity.start, entity.end]
  if (distance2(point, head) <= ANCHOR_MATCH_DISTANCE_MM) return 0
  if (distance2(point, tail) <= ANCHOR_MATCH_DISTANCE_MM) return 1
  return null
}

/** A point on an entity at parameter `t`. */
function pointOnEntity(entity: SketchEntity, t: number): Vec2 {
  if (entity.type === 'circle') {
    const angle = t * Math.PI * 2
    return [entity.center[0] + Math.cos(angle) * entity.radius, entity.center[1] + Math.sin(angle) * entity.radius]
  }
  if (entity.type === 'arc') return arcPointAt(entity, t)
  return [
    entity.start[0] + (entity.end[0] - entity.start[0]) * t,
    entity.start[1] + (entity.end[1] - entity.start[1]) * t,
  ]
}

/** The usable entities of a sketch: construction geometry sweeps nothing. */
function solidEntities(sketch: SketchFeature) {
  return sketch.entities.filter((entity) => !entity.construction)
}

/**
 * Work out what swept an edge, from its stored coordinates alone.
 *
 * Returns undefined when nothing in the document explains the edge — an edge
 * created by a fillet, for one, which no sketch entity produced. Those keep
 * their absolute coordinates and behave exactly as they did before.
 */
export function deriveEdgeAnchor(reference: FilletEdgeReference, features: Feature[]): EdgeAnchor | undefined {
  for (const { extrude, sketch } of extrusions(features)) {
    const { plane } = sketch
    const startFlat = projectToSketchPlane(plane, reference.start)
    const endFlat = projectToSketchPlane(plane, reference.end)
    const startDepth = sketchPlaneOffset(plane, reference.start)
    const endDepth = sketchPlaneOffset(plane, reference.end)
    const [near, far] = extrudeSweepRange(extrude, sketch, currentPlaneOffset(sketch, features))

    // A corner dragged along the sweep: fixed in the sketch, spanning depth.
    if (distance2(startFlat, endFlat) <= ANCHOR_MATCH_DISTANCE_MM && Math.abs(startDepth - endDepth) > ANCHOR_MATCH_DISTANCE_MM) {
      const spansSweep = Math.abs(Math.min(startDepth, endDepth) - Math.min(near, far)) <= ANCHOR_MATCH_DISTANCE_MM
        || Math.abs(Math.max(startDepth, endDepth) - Math.max(near, far)) <= ANCHOR_MATCH_DISTANCE_MM
      if (!spansSweep) continue
      for (const entity of solidEntities(sketch)) {
        const t = lateralParameter(entity, startFlat)
        if (t !== null) return { kind: 'profileLateral', sketchId: sketch.id, entityId: entity.id, featureId: extrude.id, t }
      }
      continue
    }

    // The profile curve itself, lying flat at one end of the sweep.
    if (Math.abs(startDepth - endDepth) > ANCHOR_MATCH_DISTANCE_MM) continue
    const depth: 0 | 1 | null = Math.abs(startDepth - near) <= ANCHOR_MATCH_DISTANCE_MM
      ? 0
      : Math.abs(startDepth - far) <= ANCHOR_MATCH_DISTANCE_MM ? 1 : null
    if (depth === null) continue
    for (const entity of solidEntities(sketch)) {
      const atStart = locateOnEntity(entity, startFlat)
      const atEnd = locateOnEntity(entity, endFlat)
      if (atStart && atEnd && atStart.distance <= ANCHOR_MATCH_DISTANCE_MM && atEnd.distance <= ANCHOR_MATCH_DISTANCE_MM) {
        return { kind: 'profileSweep', sketchId: sketch.id, entityId: entity.id, featureId: extrude.id, depth }
      }
    }
  }
  return deriveRevolveAnchor(reference, features)
}

/**
 * A revolve turns each vertex of its profile into a circle about the axis. An
 * edge is one of those when its ends sit at that vertex's height along the
 * axis and its distance out from it. The point between them is allowed the
 * slack of a tessellated pick, which lies on a chord rather than the curve.
 */
function deriveRevolveAnchor(reference: FilletEdgeReference, features: Feature[]): EdgeAnchor | undefined {
  for (const { revolve, sketch } of revolutions(features)) {
    const axis = revolveAxis(revolve, sketch, currentPlaneOffset(sketch, features))
    if (!axis) continue
    const [start, end, point] = [reference.start, reference.end, reference.point].map((position) => axialPosition(axis, position))
    for (const entity of solidEntities(sketch)) {
      const ends = entityEnds(entity)
      if (!ends) continue
      for (const index of [0, 1] as const) {
        const vertex = axialPosition(axis, sketchPointToWorld(sketch.plane, ends[index], currentPlaneOffset(sketch, features)))
        // A vertex on the axis sweeps nothing.
        if (vertex.radius <= ANCHOR_MATCH_DISTANCE_MM) continue
        const onCircle = (position: { along: number; radius: number }, slack: number) =>
          Math.abs(position.along - vertex.along) <= slack && Math.abs(position.radius - vertex.radius) <= slack
        const chordSlack = ANCHOR_MATCH_DISTANCE_MM + vertex.radius * 0.01
        if (onCircle(start, ANCHOR_MATCH_DISTANCE_MM) && onCircle(end, ANCHOR_MATCH_DISTANCE_MM) && onCircle(point, chordSlack)) {
          return { kind: 'profileRevolve', sketchId: sketch.id, entityId: entity.id, featureId: revolve.id, end: index }
        }
      }
    }
  }
  return undefined
}

/**
 * The circle a revolve sweeps from one vertex, as OpenCascade builds it: it
 * starts where the profile lies, in the sketch plane, and turns through the
 * revolve's angle, so a full turn starts and ends there with its middle
 * opposite.
 */
function resolveRevolveAnchor(anchor: Extract<EdgeAnchor, { kind: 'profileRevolve' }>, sketch: SketchFeature, entity: SketchEntity, features: Feature[]): FilletEdgeReference | null {
  const built = features.filter((candidate): candidate is RevolveFeature => candidate.kind === 'revolve' && candidate.sketchId === sketch.id)
  const revolve = built.find((candidate) => candidate.id === anchor.featureId) ?? built[0]
  const ends = entityEnds(entity)
  if (!revolve || !ends) return null
  const offset = currentPlaneOffset(sketch, features)
  const axis = revolveAxis(revolve, sketch, offset)
  if (!axis) return null
  const start = sketchPointToWorld(sketch.plane, ends[anchor.end], offset)
  const angle = revolve.parameters.angle
  return { start, end: rotateAboutAxis(start, axis, angle), point: rotateAboutAxis(start, axis, angle / 2) }
}

/**
 * Rebuild an edge reference from its anchor and the *current* state of the
 * document, or null when the geometry it named is gone.
 *
 * The result is a prediction of where the edge now is. It is matched against
 * the real solid downstream, so an anchor that resolves to the wrong place
 * fails to match rather than rounding an edge the user did not choose.
 */
export function resolveEdgeAnchor(anchor: EdgeAnchor, features: Feature[]): FilletEdgeReference | null {
  const sketch = features.find((candidate) => candidate.id === anchor.sketchId)
  if (sketch?.kind !== 'sketch') return null
  const entity = sketch.entities.find((candidate) => candidate.id === anchor.entityId)
  if (!entity || entity.construction) return null
  if (anchor.kind === 'profileRevolve') return resolveRevolveAnchor(anchor, sketch, entity, features)

  // Prefer the extrusion the anchor was derived against. Falling back to the
  // first one built from this sketch keeps anchors written before the id was
  // recorded working exactly as they did.
  const built = features.filter((candidate): candidate is ExtrudeFeature =>
    candidate.kind === 'extrude' && candidate.sketchId === sketch.id)
  const extrude = built.find((candidate) => candidate.id === anchor.featureId) ?? built[0]
  if (!extrude) return null
  const [near, far] = extrudeSweepRange(extrude, sketch, currentPlaneOffset(sketch, features))

  if (anchor.kind === 'profileLateral') {
    const flat = pointOnEntity(entity, anchor.t)
    const start = sketchPointToWorld(sketch.plane, flat, near)
    const end = sketchPointToWorld(sketch.plane, flat, far)
    return { start, end, point: midpoint(start, end) }
  }

  const offset = anchor.depth === 0 ? near : far
  if (entity.type === 'arc') {
    // An arc has ends worth naming, unlike a full circle. Its identifying point
    // has to be the point halfway *round* the arc, though: the chord midpoint
    // is not on the curve at all, and downstream matching compares against a
    // real mid-edge point precisely to tell curved edges from straight ones.
    const start = sketchPointToWorld(sketch.plane, arcStartPoint(entity), offset)
    const end = sketchPointToWorld(sketch.plane, arcEndPoint(entity), offset)
    return { start, end, point: sketchPointToWorld(sketch.plane, arcMidPoint(entity), offset) }
  }
  if (entity.type === 'circle') {
    // A full circle has no endpoints to name, so describe it by its extremes;
    // the midpoint is what actually identifies it.
    const start = sketchPointToWorld(sketch.plane, pointOnEntity(entity, 0), offset)
    const end = sketchPointToWorld(sketch.plane, pointOnEntity(entity, 0.5), offset)
    return { start, end, point: sketchPointToWorld(sketch.plane, pointOnEntity(entity, 0.25), offset) }
  }
  const start = sketchPointToWorld(sketch.plane, entity.start, offset)
  const end = sketchPointToWorld(sketch.plane, entity.end, offset)
  return { start, end, point: midpoint(start, end) }
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

/**
 * The reference to hand the kernel: the anchor re-derived against the current
 * document when it still resolves, and the stored coordinates otherwise.
 */
export function currentEdgeReference(reference: FilletEdgeReference, features: Feature[]): FilletEdgeReference {
  if (!reference.anchor) return reference
  const resolved = resolveEdgeAnchor(reference.anchor, features)
  return resolved ? { ...resolved, anchor: reference.anchor } : reference
}

/** Attach anchors to a set of freshly selected edges. */
export function anchorEdgeReferences(references: FilletEdgeReference[], features: Feature[]): FilletEdgeReference[] {
  return references.map((reference) => {
    const anchor = deriveEdgeAnchor(reference, features)
    return anchor ? { ...reference, anchor } : reference
  })
}
