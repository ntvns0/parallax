import { FaceFinder, getOC, measureVolume, type Shape3D } from 'replicad'
import { FACE_REFERENCE_DISTANCE_MM } from '../core/tolerance-policy'
import { FILLET_SCALE_TOLERANCE, largestWorkingScale } from './fillet-limit'
import type { KernelFeatureDiagnostic, KernelShellOperation } from './kernel-types'

/**
 * Hollowing a solid, and explaining a shell that cannot be made.
 *
 * As with fillets, the part keeps building when a shell fails: the solid
 * passes through unshelled, and the feature reports either which face it
 * lost, or the thickest wall that does build.
 */

/** How square a rebuilt face's normal must be to the picked one, as a cosine. */
const FACE_NORMAL_AGREEMENT = 0.95

type Face = Shape3D['faces'][number]

function normalAt(face: Face, point: readonly number[]) {
  const normal = face.normalAt(point as [number, number, number])
  try {
    return normal.normalized().toTuple()
  } finally {
    normal.delete()
  }
}

/** The face of `shape` a picked point and normal name, or null when none does. */
export function findPickedFace(shape: Shape3D, picked: KernelShellOperation['faces'][number]): Face | null {
  const near = new FaceFinder().withinDistance(FACE_REFERENCE_DISTANCE_MM, picked.point).find(shape)
  return near.find((face) => {
    const normal = normalAt(face, picked.point)
    return normal.reduce((total, value, axis) => total + value * picked.normal[axis], 0) > FACE_NORMAL_AGREEMENT
  }) ?? null
}

function isValidSolid(shape: Shape3D) {
  const oc = getOC() as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false)
  try {
    return analyzer.IsValid_2() as boolean
  } finally {
    analyzer.delete()
  }
}

export function applyShell(shape: Shape3D, operation: KernelShellOperation): { shape: Shape3D; unresolved: KernelFeatureDiagnostic[] } {
  const faces = operation.faces.map((picked) => findPickedFace(shape, picked))
  const lost = faces.findIndex((face) => face === null)
  if (lost >= 0) {
    return {
      shape,
      unresolved: [{
        featureId: operation.featureId,
        featureName: operation.featureName,
        severity: 'warning',
        code: 'unresolved-face',
        reason: 'missing',
        subject: { kind: 'face', label: 'Face to open' },
        message: `${operation.featureName} could not find face ${lost + 1} of the ${operation.faces.length} it opens. The part before it has changed there. Pick the faces again.`,
        repairs: [{ kind: 'reselect-face', label: 'Reselect faces' }],
      }],
    }
  }

  const before = measureVolume(shape)
  // A wall with no room inside makes OpenCascade throw a bare status code.
  // The result is also checked, so a shell that comes back invalid, or no
  // smaller than it went in, is refused the same way.
  const attempt = (scale: number): Shape3D | null => {
    let result: Shape3D | null = null
    try {
      result = shape.shell({ thickness: operation.thickness * scale, filter: { find: () => faces as Face[] } as unknown as FaceFinder })
      const volume = measureVolume(result)
      if (isValidSolid(result) && volume > 0 && volume < before) return result
    } catch {
      // Refused outright: the same answer as an unusable result.
    }
    result?.delete()
    return null
  }

  const shelled = attempt(1)
  if (shelled) return { shape: shelled, unresolved: [] }

  const usable = largestWorkingScale((scale) => {
    const probe = attempt(scale)
    probe?.delete()
    return probe !== null
  })
  const works = usable >= FILLET_SCALE_TOLERANCE * 2
  const suggested = Number((operation.thickness * usable).toFixed(2))
  return {
    shape,
    unresolved: [{
      featureId: operation.featureId,
      featureName: operation.featureName,
      severity: 'warning',
      code: 'oversized-shell',
      reason: 'limit-exceeded',
      subject: { kind: 'parameter', label: 'Wall thickness' },
      message: works
        ? `${operation.featureName} cannot leave ${operation.thickness} mm walls here: the inside runs out of room. The thickest wall that works is about ${suggested} mm.`
        : `${operation.featureName} could not be built at any wall thickness. Try opening different faces.`,
      repairs: works
        ? [{ kind: 'apply-thickness', label: 'Apply suggested thickness', value: suggested }]
        : [{ kind: 'reselect-face', label: 'Reselect faces' }],
    }],
  }
}
