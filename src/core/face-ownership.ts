import { distanceToArc } from './arc-geometry'
import { currentEdgeReference } from './edge-anchor'
import { extrudeSweepRange } from './extrude-direction'
import { currentPlaneOffset } from './face-anchor'
import type { ExtrudeFeature, Feature, SketchEntity, SketchFeature, Vec2, Vec3 } from './model'
import { getProfileRegions, pointInProfile } from './sketch'
import { projectToSketchPlane, sketchPlaneOffset } from './sketch-plane'
import { FACE_OWNERSHIP_DISTANCE_MM } from './tolerance-policy'

/**
 * Which feature is responsible for each face of the finished solid.
 *
 * Selecting a feature should show what that feature did, not light up the whole
 * body. The body is a single mesh by the time it reaches the viewport, though,
 * and nothing in it records provenance — so ownership is worked out the same
 * way edge anchors are, by asking which feature's geometry a face lies on.
 *
 * Later features are tested first, because a feature modifies what came before
 * it: a fillet replaces part of the wall it rounds, and the rounded face
 * belongs to the fillet rather than to the extrusion underneath.
 *
 * This is a presentation aid, not geometry. A face it cannot explain is left
 * unowned and simply does not highlight, which is a cosmetic miss rather than
 * anything that can produce wrong material.
 */

/** A face of the solid, reduced to what ownership tests actually need. */
export type FaceSample = {
  /** Points spread across the face, in world space. */
  points: Vec3[]
  /** False when the face is curved, as a fillet's surface is. */
  planar: boolean
}

function distanceToSegment(point: Vec3, start: Vec3, end: Vec3) {
  const delta = end.map((value, index) => value - start[index])
  const lengthSquared = delta.reduce((total, value) => total + value * value, 0)
  const fraction = lengthSquared < 1e-12
    ? 0
    : Math.max(0, Math.min(1, delta.reduce((total, value, index) => total + (point[index] - start[index]) * value, 0) / lengthSquared))
  return Math.hypot(...delta.map((value, index) => start[index] + value * fraction - point[index]))
}

/** Distance from a 2D point to a sketch entity's curve. */
function distanceToEntity(entity: SketchEntity, point: Vec2): number {
  if (entity.type === 'circle') {
    return Math.abs(Math.hypot(point[0] - entity.center[0], point[1] - entity.center[1]) - entity.radius)
  }
  // Measured against the arc itself, so a face out on the part of the circle
  // the arc does not cover is not mistaken for one this entity swept.
  if (entity.type === 'arc') return distanceToArc(entity, point)
  const dx = entity.end[0] - entity.start[0]
  const dy = entity.end[1] - entity.start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-12) return Math.hypot(point[0] - entity.start[0], point[1] - entity.start[1])
  const t = Math.max(0, Math.min(1, ((point[0] - entity.start[0]) * dx + (point[1] - entity.start[1]) * dy) / lengthSquared))
  return Math.hypot(point[0] - (entity.start[0] + dx * t), point[1] - (entity.start[1] + dy * t))
}

/**
 * True when a face lies on the surface swept by an extrusion: either a wall
 * following the profile boundary, or a cap closing one end of the sweep.
 */
function extrudeOwnsFace(face: FaceSample, extrude: ExtrudeFeature, sketch: SketchFeature, features: Feature[]): boolean {
  if (!face.planar) return false
  const [start, end] = extrudeSweepRange(extrude, sketch, currentPlaneOffset(sketch, features))
  const near = Math.min(start, end)
  const far = Math.max(start, end)
  const flat = face.points.map((point) => projectToSketchPlane(sketch.plane, point))
  const depths = face.points.map((point) => sketchPlaneOffset(sketch.plane, point))
  const entities = sketch.entities.filter((entity) => !entity.construction)

  const withinSweep = depths.every((depth) => depth >= near - FACE_OWNERSHIP_DISTANCE_MM && depth <= far + FACE_OWNERSHIP_DISTANCE_MM)
  if (withinSweep && entities.some((entity) => flat.every((point) => distanceToEntity(entity, point) <= FACE_OWNERSHIP_DISTANCE_MM))) {
    return true
  }

  // A cap sits flat at one end of the sweep, inside the profile it closes.
  const atOneEnd = depths.every((depth) => Math.abs(depth - near) <= FACE_OWNERSHIP_DISTANCE_MM)
    || depths.every((depth) => Math.abs(depth - far) <= FACE_OWNERSHIP_DISTANCE_MM)
  if (!atOneEnd) return false
  return getProfileRegions(sketch).some((region) =>
    flat.every((point) => pointInProfile(point, region.outer) && !region.holes.some((hole) => pointInProfile(point, hole))))
}

/**
 * True when a face is the rounded surface a fillet produced.
 *
 * A fillet of radius r replaces the sharp edge with an arc, every point of
 * which lies between about 0.4r and r of the original edge — 0.4r at the middle
 * of the arc, r where it runs tangent into each face. Requiring the face to be
 * curved as well keeps the flat faces on either side out of it.
 */
function filletOwnsFace(face: FaceSample, radius: number, edges: { start: Vec3; end: Vec3 }[]): boolean {
  if (face.planar || radius <= 0) return false
  const outer = radius * 1.15 + FACE_OWNERSHIP_DISTANCE_MM
  const inner = radius * 0.3
  return edges.some((edge) => face.points.every((point) => {
    const gap = distanceToSegment(point, edge.start, edge.end)
    return gap <= outer && gap >= inner - FACE_OWNERSHIP_DISTANCE_MM
  }))
}

/**
 * Attribute each face to the feature that made it, or null where no feature
 * explains it.
 */
export function attributeFaces(faces: FaceSample[], features: Feature[]): (string | null)[] {
  const ordered = [...features].reverse()
  return faces.map((face) => {
    for (const feature of ordered) {
      if (feature.kind === 'fillet') {
        const edges = feature.edges.map((edge) => currentEdgeReference(edge, features))
        if (filletOwnsFace(face, feature.parameters.radius, edges)) return feature.id
        continue
      }
      if (feature.kind !== 'extrude') continue
      const sketch = features.find((candidate) => candidate.id === feature.sketchId)
      if (sketch?.kind !== 'sketch') continue
      if (extrudeOwnsFace(face, feature, sketch, features)) return feature.id
    }
    return null
  })
}
