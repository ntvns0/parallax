import type { LineEntity, RevolveFeature, SketchFeature, Vec2, Vec3 } from './model'
import { sketchPointToWorld } from './sketch-plane'

/** A revolve axis in world space. `direction` has unit length. */
export type RevolveAxis = { origin: Vec3; direction: Vec3 }

/** A revolve axis in its sketch's own coordinates. `direction` has unit length. */
export type SketchRevolveAxis = { origin: Vec2; direction: Vec2 }

/** The lines a revolve can turn about: the sketch's centrelines, which are its construction lines. */
export function revolveAxisCandidates(sketch: SketchFeature): LineEntity[] {
  return sketch.entities.filter((entity): entity is LineEntity => entity.type === 'line' && entity.construction)
}

/**
 * Where a revolve's axis lies in its sketch.
 *
 * A revolve that names a line in its sketch turns about that line, wherever it
 * is drawn, and follows it when the sketch changes. Otherwise it turns about
 * the sketch's own X or Y axis through the sketch origin. Null when the named
 * line no longer exists or has no length, so the revolve cannot be built.
 */
export function revolveAxisInSketch(revolve: Pick<RevolveFeature, 'axisEntityId' | 'parameters'>, sketch: SketchFeature): SketchRevolveAxis | null {
  if (!revolve.axisEntityId) return { origin: [0, 0], direction: revolve.parameters.axis === 'X' ? [1, 0] : [0, 1] }
  const line = sketch.entities.find((entity) => entity.id === revolve.axisEntityId)
  if (line?.type !== 'line') return null
  const length = Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1])
  if (length < 1e-9) return null
  return { origin: line.start, direction: [(line.end[0] - line.start[0]) / length, (line.end[1] - line.start[1]) / length] }
}

/** The same axis in world space, with the sketch at `planeOffset`. */
export function revolveAxis(revolve: Pick<RevolveFeature, 'axisEntityId' | 'parameters'>, sketch: SketchFeature, planeOffset: number): RevolveAxis | null {
  const axis = revolveAxisInSketch(revolve, sketch)
  if (!axis) return null
  const origin = sketchPointToWorld(sketch.plane, axis.origin, planeOffset)
  const ahead = sketchPointToWorld(sketch.plane, [axis.origin[0] + axis.direction[0], axis.origin[1] + axis.direction[1]], planeOffset)
  return { origin, direction: [ahead[0] - origin[0], ahead[1] - origin[1], ahead[2] - origin[2]] }
}

/**
 * Where a point sits relative to an axis: how far along it, and how far out.
 * Every point a revolve sweeps from one profile point shares both numbers.
 */
export function axialPosition(axis: RevolveAxis, point: Vec3): { along: number; radius: number } {
  const offset = [point[0] - axis.origin[0], point[1] - axis.origin[1], point[2] - axis.origin[2]]
  const along = offset[0] * axis.direction[0] + offset[1] * axis.direction[1] + offset[2] * axis.direction[2]
  const radial = offset.map((value, index) => value - axis.direction[index] * along)
  return { along, radius: Math.hypot(...radial) }
}

/** A point turned about an axis by `degrees`, counter-clockwise looking down the axis toward its origin. */
export function rotateAboutAxis(point: Vec3, axis: RevolveAxis, degrees: number): Vec3 {
  const angle = degrees * Math.PI / 180
  const [kx, ky, kz] = axis.direction
  const [vx, vy, vz] = [point[0] - axis.origin[0], point[1] - axis.origin[1], point[2] - axis.origin[2]]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dot = kx * vx + ky * vy + kz * vz
  // Rodrigues: v cosθ + (k × v) sinθ + k (k·v)(1 − cosθ).
  const cross = [ky * vz - kz * vy, kz * vx - kx * vz, kx * vy - ky * vx]
  const turned = [vx, vy, vz].map((value, index) => value * cos + cross[index] * sin + axis.direction[index] * dot * (1 - cos))
  return [turned[0] + axis.origin[0], turned[1] + axis.origin[1], turned[2] + axis.origin[2]]
}
