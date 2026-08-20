import type { SketchPlane, Vec3 } from './model'
import { sketchPlaneOffset } from './sketch-plane'

/** The distance a sketch extrudes when nothing better can be worked out. */
export const FALLBACK_EXTRUDE_DISTANCE_MM = 25

/**
 * How much material sits behind a sketch drawn on a face, along that face's
 * normal, in millimetres.
 *
 * This is the depth that cuts straight through the body and stops — the most
 * useful thing a pocket can default to, and a far better starting magnitude
 * than a fixed number that might be invisible on a small part or wildly
 * oversized on a large one.
 *
 * Vertices are the flat `[x, y, z, x, y, z, …]` array the kernel returns.
 * Returns null when the mesh is empty or the sketch plane does not actually sit
 * against it, because a guess derived from nothing is worse than a known
 * default.
 */
export function materialDepthUnderSketch(
  vertices: ArrayLike<number>,
  plane: SketchPlane,
  planeOffset: number,
  faceNormalSign: -1 | 1,
): number | null {
  if (vertices.length < 3) return null

  // Work in the plane's own normal coordinate, the same one `planeOffset` is
  // measured in, so the comparison below needs no per-plane special casing.
  let nearest = Infinity
  let furthest = -Infinity
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const along = sketchPlaneOffset(plane, [vertices[index], vertices[index + 1], vertices[index + 2]] as Vec3)
    if (along < nearest) nearest = along
    if (along > furthest) furthest = along
  }
  if (!Number.isFinite(nearest) || !Number.isFinite(furthest)) return null

  // Material lies opposite the outward normal, so an outward-facing sketch is
  // backed by everything below it and vice versa.
  const depth = faceNormalSign > 0 ? planeOffset - nearest : furthest - planeOffset
  return depth > 0.001 ? depth : null
}

/**
 * The distance a new extrusion should start at. Positive: a sketch on a face
 * grows outward by default, and the direction is what later turns it into a
 * pocket — see extrude-direction.ts.
 */
export function defaultExtrudeDistance(depthUnderSketch: number | null): number {
  return depthUnderSketch ?? FALLBACK_EXTRUDE_DISTANCE_MM
}
