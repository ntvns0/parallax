import type { ExtrudeFeature, Feature, SketchFeature } from './model'

export type ExtrudeOperation = ExtrudeFeature['operation']

/**
 * Which way an extrusion grows, and what that means for the boolean.
 *
 * For a sketch on a base plane, the stored distance is measured along that
 * plane's normal and the boolean is whatever the user chose — the two are
 * independent.
 *
 * For a sketch attached to a face of an existing solid they are not. The stored
 * distance is measured along the face's *outward* normal, so its sign already
 * says what the user is doing: growing away from the solid adds material,
 * digging into it removes material. Deriving the boolean from that one rule is
 * how push/pull behaves in every direct modeler, and it replaces an older guess
 * that read the operation off the profile shape — circles became holes and
 * everything else became a boss, which is not something a user can predict.
 *
 * `newBody` is never inferred away. Starting a detached body from a face is a
 * deliberate choice that neither direction implies.
 */

/** True when this sketch is attached to a face rather than a base plane. */
export function isFaceAttached(sketch: SketchFeature | undefined): boolean {
  return Boolean(sketch?.parameters.faceNormalSign)
}

/**
 * The extrusion distance expressed along the sketch plane's own normal, which
 * is what the kernel and the preview geometry both work in.
 */
export function planeNormalDistance(distance: number, faceNormalSign: -1 | 1 | undefined): number {
  return faceNormalSign ? distance * faceNormalSign : distance
}

/** The boolean a face-attached extrusion describes, from its direction alone. */
export function operationForDistance(distance: number, current: ExtrudeOperation): ExtrudeOperation {
  if (current === 'newBody') return current
  return distance < 0 ? 'cut' : 'add'
}

/** The distance sign matching an operation, preserving the magnitude the user typed. */
export function distanceForOperation(distance: number, operation: ExtrudeOperation): number {
  if (operation === 'newBody') return distance
  const magnitude = Math.abs(distance)
  return operation === 'cut' ? -magnitude : magnitude
}

/**
 * Where an extrusion starts and finishes along its sketch plane's normal.
 *
 * The first value is the end lying on the sketch plane itself — the middle of
 * the sweep, for a symmetric one — and the second is the far end. Anything
 * asking which face of a solid an extrusion produced needs this, so it lives
 * here rather than being re-derived with a slightly different sign each time.
 */
export function extrudeSweepRange(
  extrude: ExtrudeFeature,
  sketch: SketchFeature,
  /**
   * Where the sketch plane sits. Defaults to the stored offset; callers holding
   * the whole document should pass `currentPlaneOffset` instead, so a sketch
   * attached to a face follows that face when the feature under it changes.
   */
  planeOffset: number = sketch.parameters.planeOffset,
): [number, number] {
  const depth = planeNormalDistance(extrude.parameters.distance, sketch.parameters.faceNormalSign)
  const base = extrude.parameters.symmetric ? planeOffset - depth / 2 : planeOffset
  return [base, base + depth]
}

/** The sketch an extrusion is built from, when it is still present and really a sketch. */
export function sketchForExtrude(feature: ExtrudeFeature, features: Feature[]): SketchFeature | undefined {
  const source = features.find((candidate) => candidate.id === feature.sketchId)
  return source?.kind === 'sketch' ? source : undefined
}
