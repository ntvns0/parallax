import type { SketchPlane, Vec3 } from '../core/model'

// The plane maths moved to core, where sketch anchoring and extrude defaults
// also need it. Re-exported so face picking still reads as one module.
export { projectToSketchPlane, sketchPlaneOffset } from '../core/sketch-plane'

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
