import { deriveFaceAnchor, resolveFacePlane } from './face-anchor'
import type { FaceReference, Feature, ShellParameters, Vec3 } from './model'
import { classifyFaceNormal, projectToSketchPlane, sketchPlaneOffset, sketchPointToWorld } from './sketch-plane'

/**
 * The Shell feature's rules, and keeping its picked faces on the faces they
 * were picked on.
 *
 * A face is picked as a point and a normal. When the face is the end of an
 * extrusion, it also gets an anchor naming that end, so that when the
 * extrusion gets taller the point rides up with the face rather than being
 * left floating where the face used to be.
 */

/** The wall a shell is asked for that cannot be made, or null when it can. */
export function shellProblem(parameters: ShellParameters): string | null {
  if (!(parameters.thickness > 0)) return 'The wall thickness must be more than zero.'
  return null
}

/**
 * What made a picked face, when it can be worked out: an extrusion end lying
 * where the face does. Only `earlier` features are searched, which should be
 * the ones before the shell, so a shell cannot anchor to something it made.
 */
export function deriveFaceReferenceAnchor(point: Vec3, normal: Vec3, earlier: Feature[]): FaceReference['anchor'] {
  const orientation = classifyFaceNormal(normal)
  if (!orientation) return undefined
  return deriveFaceAnchor({ plane: orientation.plane, parameters: { planeOffset: sketchPlaneOffset(orientation.plane, point) } }, earlier)
}

/** A face as picked, with its anchor when one can be derived. */
export function faceReference(point: Vec3, normal: Vec3, earlier: Feature[]): FaceReference {
  const length = Math.hypot(...normal)
  const unit = normal.map((value) => value / (length || 1)) as Vec3
  const anchor = deriveFaceReferenceAnchor(point, unit, earlier)
  return { point, normal: unit, ...(anchor ? { anchor } : {}) }
}

/**
 * The face reference as the document now places it: the point moved along
 * the face's normal to wherever its anchor now resolves. A reference whose
 * anchor no longer resolves stays where it was picked.
 */
export function currentFaceReference(reference: FaceReference, features: Feature[]): FaceReference {
  const resolved = reference.anchor && resolveFacePlane(reference.anchor, features)
  if (!resolved) return reference
  const point = sketchPointToWorld(resolved.plane, projectToSketchPlane(resolved.plane, reference.point), resolved.offset)
  return { ...reference, point }
}

/** How square two picks' normals must be to be on the same face, as a cosine. */
const SAME_FACE_NORMAL = 0.999
/** How far apart two picks' planes may be and still be the same face, in millimetres. */
const SAME_FACE_DISTANCE_MM = 0.05

/**
 * Whether two picks are on the same face: facing the same way, in the same
 * plane. Picking a face again unpicks it. Two separate faces in one plane
 * count as one, which only matters if both are to be opened.
 */
export function sameFace(a: Pick<FaceReference, 'point' | 'normal'>, b: Pick<FaceReference, 'point' | 'normal'>): boolean {
  const facing = a.normal.reduce((total, value, axis) => total + value * b.normal[axis], 0)
  const apart = a.normal.reduce((total, value, axis) => total + value * (b.point[axis] - a.point[axis]), 0)
  return facing > SAME_FACE_NORMAL && Math.abs(apart) < SAME_FACE_DISTANCE_MM
}
