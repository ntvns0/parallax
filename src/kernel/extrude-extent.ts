/**
 * Where an extrusion starts and stops along its sketch normal, in millimeters.
 *
 * `origin` is the tool's start point relative to the sketch plane. When it is
 * undefined the tool starts on the plane itself, which is what Replicad does by
 * default.
 */
export type ExtrudeExtent = {
  distance: number
  origin?: [number, number, number]
}

/**
 * How far a cutting tool is pushed back through its entry face.
 *
 * OpenCascade booleans are unreliable when the tool's cap lands exactly on a
 * face of the parent solid: the two coplanar faces make the result ambiguous
 * and OCC either raises a boolean error or returns a solid with a
 * zero-thickness sliver where the cut should be. Starting the tool slightly
 * behind the entry face removes the coplanar pair entirely.
 *
 * This overshoot only ever exists *outside* the material being cut, so it does
 * not change the finished part. `extrudeExtent` lengthens the tool by the same
 * amount it pushes the start back, which keeps the cut depth measured from the
 * sketch plane exactly as the user requested — see the regression test in
 * extrude-extent.test.ts.
 */
export const CUT_ENTRY_OVERSHOOT_MM = 0.05

/**
 * Resolve the start point and length of one extrusion tool.
 *
 * Symmetric extents straddle the sketch plane. Asymmetric cuts get the entry
 * overshoot described above. Everything else starts on the plane.
 */
export function extrudeExtent(operation: {
  distance: number
  symmetric: boolean
  operation: 'newBody' | 'add' | 'cut'
}): ExtrudeExtent {
  if (operation.symmetric) {
    return { distance: operation.distance, origin: [0, 0, -operation.distance / 2] }
  }
  if (operation.operation !== 'cut') {
    return { distance: operation.distance }
  }
  const direction = Math.sign(operation.distance) || 1
  const overshoot = direction * CUT_ENTRY_OVERSHOOT_MM
  return {
    distance: operation.distance + overshoot,
    origin: [0, 0, -overshoot],
  }
}

/**
 * The near and far ends of an extent along the sketch normal, measured from the
 * sketch plane. Tests assert against this rather than re-deriving the overshoot
 * arithmetic they are meant to be checking.
 */
export function extrudeReach(extent: ExtrudeExtent) {
  const start = extent.origin ? extent.origin[2] : 0
  return { start, end: start + extent.distance }
}
