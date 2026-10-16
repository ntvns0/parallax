import type { SketchPlane, Vec2, Vec3 } from './model'

/**
 * Converting between world space and a sketch plane's own 2D frame.
 *
 * Every sketch lives on one of the three principal planes at some offset along
 * that plane's normal, so a world point splits cleanly into a 2D position in
 * the sketch and a signed distance from it. Sketch geometry, extrusion depths,
 * face picking and edge anchoring all need the same conversion, which is why it
 * lives here rather than next to any one of them.
 *
 * The Z-up convention means an XY sketch extrudes along Z, XZ along -Y and YZ
 * along X. That -Y is the only asymmetry, and it is the source of every sign
 * flip you will find around sketch planes.
 */

/** How far a point sits from the origin along the plane's normal. */
export function sketchPlaneOffset(plane: SketchPlane, point: Vec3): number {
  if (plane === 'XY') return point[2]
  if (plane === 'XZ') return -point[1]
  return point[0]
}

/** Project a world point into the plane's own 2D sketch coordinates. */
export function projectToSketchPlane(plane: SketchPlane, point: Vec3): Vec2 {
  if (plane === 'XZ') return [point[0], point[2]]
  if (plane === 'YZ') return [point[1], point[2]]
  return [point[0], point[1]]
}

/**
 * The inverse of the two functions above: place a sketch-space point back into
 * world space at a given distance along the plane normal.
 */
export function sketchPointToWorld(plane: SketchPlane, point: Vec2, offset: number): Vec3 {
  if (plane === 'XZ') return [point[0], -offset, point[1]]
  if (plane === 'YZ') return [offset, point[0], point[1]]
  return [point[0], point[1], offset]
}

/**
 * How square to an axis a face has to be before it can host a sketch. Anything
 * flatter is refused rather than silently snapped, because a sketch attached to
 * a nearly-axis-aligned face would place geometry somewhere the user did not
 * ask for. Arbitrary datum planes are the real fix; see ROADMAP milestone 3.
 */
export const AXIS_ALIGNMENT_TOLERANCE = 0.995

export type FaceOrientation = {
  plane: SketchPlane
  /** +1 when the face normal points along the plane's positive axis. */
  faceNormalSign: -1 | 1
}

/**
 * Work out which principal plane a face lies in from its world-space normal,
 * or null when the face is not axis-aligned enough to support one.
 *
 * The Z-up convention means an XY sketch extrudes along Z, XZ along -Y, and YZ
 * along X, which is where the sign flip on the XZ branch comes from.
 */
export function classifyFaceNormal(normal: Vec3): FaceOrientation | null {
  const components = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])]
  const dominantAxis = components.indexOf(Math.max(...components))
  if (components[dominantAxis] < AXIS_ALIGNMENT_TOLERANCE) return null

  const plane: SketchPlane = dominantAxis === 2 ? 'XY' : dominantAxis === 1 ? 'XZ' : 'YZ'
  const alongPlaneNormal = plane === 'XY' ? normal[2] : plane === 'XZ' ? -normal[1] : normal[0]
  return { plane, faceNormalSign: alongPlaneNormal >= 0 ? 1 : -1 }
}
