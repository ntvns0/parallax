import { extrudeSweepRange, sketchForExtrude } from './extrude-direction'
import { currentPlaneOffset } from './face-anchor'
import type { FaceSample } from './face-ownership'
import type { ExtrudeFeature, Feature, SketchFeature, SketchPlane, Vec2, Vec3 } from './model'
import { sketchBounds } from './sketch'
import { projectToSketchPlane, sketchPlaneOffset } from './sketch-plane'
import { ANCHOR_MATCH_DISTANCE_MM } from './tolerance-policy'

/**
 * Dragging a face to change the feature that made it.
 *
 * Every dimension in the application is currently typed into a panel. Push/pull
 * is the other half: grab the end of a sweep, move it, and the extrusion that
 * produced it takes the new depth. The panel stays the precise path; this is the
 * fast one.
 *
 * What makes it parametric rather than a mesh edit is that nothing here touches
 * geometry. A drag resolves to *which feature owns this face and what number on
 * it the face represents*, and then that number changes — so the whole history
 * downstream rebuilds, and the change survives a reload like any other edit.
 *
 * Only the ends of a sweep can be dragged. A side wall follows the sketch
 * profile, so moving it would mean editing sketch geometry, which is a different
 * operation with a different undo story and belongs in the sketcher.
 */

/** The world direction along which a sketch plane's offset increases. */
export function planeNormalAxis(plane: SketchPlane): Vec3 {
  if (plane === 'XZ') return [0, -1, 0]
  if (plane === 'YZ') return [1, 0, 0]
  return [0, 0, 1]
}

export type PushPullTarget = {
  /** The extrusion whose distance this face represents. */
  featureId: string
  featureName: string
  /** Which end of the sweep: 0 is the sketch-plane end, 1 the far end. */
  depth: 0 | 1
  /** World direction the face travels when the drag value grows. */
  axis: Vec3
  /** The extrusion's distance as it stands, in millimetres. */
  distance: number
  /**
   * Millimetres of distance gained per millimetre the face moves along `axis`.
   *
   * A symmetric extrusion straddles its sketch plane, so each end carries half
   * the depth and moving one end by 1 mm lengthens the feature by 2 mm. Getting
   * this wrong makes symmetric features feel like they are fighting the pointer.
   */
  distancePerMillimetre: number
}

/** Average depth of a face along its plane's normal. */
function faceDepth(plane: SketchPlane, face: FaceSample): number {
  const depths = face.points.map((point) => sketchPlaneOffset(plane, point))
  return depths.reduce((total, value) => total + value, 0) / depths.length
}

/** True when every sampled point sits at the same depth: a cap, not a wall. */
function isFlatAgainstPlane(plane: SketchPlane, face: FaceSample, depth: number): boolean {
  return face.points.every((point) => Math.abs(sketchPlaneOffset(plane, point) - depth) <= ANCHOR_MATCH_DISTANCE_MM)
}

/**
 * Whether a face sits over the profile that swept it.
 *
 * Deliberately a bounding-box test rather than point-in-polygon. A planar cap is
 * tessellated entirely from vertices on its own boundary, and ray-casting
 * containment is undefined exactly on a boundary — `face-ownership.ts` attributes
 * such a cap to nothing at all for that reason, which is a cosmetic miss for
 * highlighting but would make push/pull refuse the only faces it can act on.
 *
 * Overlap is only needed to separate two features that happen to end at the same
 * depth; the depth match itself does the real identification.
 */
function overSketchFootprint(sketch: SketchFeature, points: Vec2[]): boolean {
  const bounds = sketchBounds(sketch.entities.filter((entity) => !entity.construction))
  return points.every((point) =>
    point[0] >= bounds.min[0] - ANCHOR_MATCH_DISTANCE_MM
    && point[0] <= bounds.max[0] + ANCHOR_MATCH_DISTANCE_MM
    && point[1] >= bounds.min[1] - ANCHOR_MATCH_DISTANCE_MM
    && point[1] <= bounds.max[1] + ANCHOR_MATCH_DISTANCE_MM)
}

/**
 * What dragging this face would edit, or null when it is not draggable.
 *
 * Returns null for curved faces, for the walls of a sweep, for faces that match
 * no extrusion, and for the sketch-plane end of an asymmetric extrusion — that
 * end is the sketch itself, and moving it would move the sketch rather than
 * change a depth. A symmetric extrusion has no such end: both of its caps are
 * made by the distance, so both can be dragged.
 *
 * Extrusions are searched newest first, the same rule `deriveFaceAnchor` uses:
 * the face a user just clicked belongs to the solid as it stands, so when an
 * older extrusion happens to end at the same height the most recent one is the
 * better answer.
 */
export function pushPullTargetForFace(face: FaceSample, features: Feature[]): PushPullTarget | null {
  if (!face.planar || !face.points.length) return null

  for (let index = features.length - 1; index >= 0; index -= 1) {
    const owner = features[index]
    if (owner.kind !== 'extrude' || !owner.visible) continue
    const sketch = sketchForExtrude(owner, features)
    if (!sketch) continue

    const depth = faceDepth(sketch.plane, face)
    if (!isFlatAgainstPlane(sketch.plane, face, depth)) continue
    if (!overSketchFootprint(sketch, face.points.map((point) => projectToSketchPlane(sketch.plane, point)))) continue

    const [near, far] = extrudeSweepRange(owner, sketch, currentPlaneOffset(sketch, features))
    const symmetric = owner.parameters.symmetric
    const end = Math.abs(depth - far) <= ANCHOR_MATCH_DISTANCE_MM
      ? 1 as const
      : Math.abs(depth - near) <= ANCHOR_MATCH_DISTANCE_MM
        ? 0 as const
        : null
    if (end === null) continue
    if (end === 0 && !symmetric) continue

    return {
      featureId: owner.id,
      featureName: owner.name,
      depth: end,
      axis: planeNormalAxis(sketch.plane),
      distance: owner.parameters.distance,
      distancePerMillimetre: pullRate(owner, sketch.parameters.faceNormalSign, end),
    }
  }
  return null
}

/**
 * How the stored distance responds to the face moving along the plane normal.
 *
 * Two sign conventions meet here. A symmetric sweep splits its depth across both
 * caps, and its near cap travels *against* the depth. A face-attached sketch
 * stores its distance along the face's outward normal rather than the plane's,
 * which `planeNormalDistance` folds in — so the same flip has to be undone to
 * turn a movement back into a distance.
 */
function pullRate(extrude: ExtrudeFeature, faceNormalSign: -1 | 1 | undefined, end: 0 | 1): number {
  const magnitude = extrude.parameters.symmetric ? 2 : 1
  const towardsDepth = end === 0 ? -1 : 1
  // planeNormalDistance multiplies by the sign, and the sign is ±1, so the same
  // multiplication converts a plane-normal delta back to a stored distance.
  const orientation = faceNormalSign ?? 1
  return magnitude * towardsDepth * orientation
}

/** The distance a drag of `millimetres` along the target's axis produces. */
export function distanceAfterPull(target: PushPullTarget, millimetres: number): number {
  return target.distance + millimetres * target.distancePerMillimetre
}

/**
 * The smallest sweep the kernel will accept. Zero depth has no volume and
 * OpenCascade rejects it outright.
 */
export const MIN_PULL_DISTANCE_MM = 0.001

/**
 * Keep a dragged distance buildable without blocking a change of direction.
 *
 * Crossing zero is not a mistake to be prevented: on a face-attached sketch the
 * sign *is* the operation, so dragging a boss back through its face and onward
 * turns it into a pocket. That is the behaviour `extrude-direction.ts` describes
 * and the reason a drag may flip sign — all this does is step over the one value
 * that cannot be built.
 */
export function clampPulledDistance(distance: number, original: number): number {
  if (Math.abs(distance) >= MIN_PULL_DISTANCE_MM) return distance
  const heading = distance === 0 ? (original < 0 ? -1 : 1) : Math.sign(distance)
  return heading * MIN_PULL_DISTANCE_MM
}
