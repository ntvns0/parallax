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
