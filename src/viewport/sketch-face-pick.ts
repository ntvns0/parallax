import type * as THREE from 'three'
import { useDocumentStore } from '../core/document-store'
import type { SketchFaceAttachment, SketchPlane, Vec3 } from '../core/model'
import { classifyFaceNormal, sketchPlaneOffset } from './face-classification'
import { describeFace, hitFaceTriangles } from './face-geometry'

export type SketchFacePickResult =
  | { ok: true; plane: SketchPlane; planeOffset: number; faceNormalSign: -1 | 1; featureName: string; attachment: SketchFaceAttachment }
  | { ok: false; message: string }

export const NO_FACE: SketchFacePickResult = { ok: false, message: 'Choose a planar face on a visible solid.' }

/** Whether a sketch can go on the face a raycast hit, and where it would sit. */
export function classifySketchFace(hit: THREE.Intersection): SketchFacePickResult {
  if (!hit.face) return NO_FACE
  const featureId = hit.object.userData.featureId as string
  const feature = useDocumentStore.getState().document.features.find((candidate) => candidate.id === featureId)
  if (!feature || feature.kind === 'sketch' || feature.kind === 'sphere') {
    return { ok: false, message: 'That surface cannot host a sketch. Choose a flat face.' }
  }
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
  const orientation = classifyFaceNormal(normal.toArray() as Vec3)
  if (!orientation) {
    return { ok: false, message: 'This version supports axis-aligned planar faces. Choose a top, front, or side face.' }
  }
  const { plane, faceNormalSign } = orientation
  if (feature.kind === 'cylinder' && plane !== 'XY') {
    return { ok: false, message: 'Choose one of the cylinder’s flat end caps.' }
  }
  const point = hit.point.toArray() as Vec3
  const attachment = describeFace(hitFaceTriangles(hit), hit.object.matrixWorld, point, plane, feature, faceNormalSign)
  return { ok: true, plane, planeOffset: sketchPlaneOffset(plane, point), faceNormalSign, featureName: feature.name, attachment }
}

/** Identifies a pick result, so hovering across one face reports it once. */
export function sketchFacePickKey(result: SketchFacePickResult) {
  return result.ok
    ? `ok:${result.featureName}:${result.plane}:${result.planeOffset.toFixed(3)}:${result.faceNormalSign}`
    : `error:${result.message}`
}
