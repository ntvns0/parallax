import type { Shape3D } from 'replicad'
import type { FilletEdgeReference } from '../core/model'
import type { KernelFeatureDiagnostic, KernelFilletOperation } from './kernel-types'
import { matchesFilletEdge, matchesFilletSourceEdge } from './fillet-edge-reference'
import { describeUnresolvedEdge, nearestMovedEdge } from './unresolved-edge'
import { FILLET_SCALE_TOLERANCE, describeOversizedFillet, largestWorkingScale } from './fillet-limit'

/**
 * Applying fillets to a solid, and explaining the ones that cannot be applied.
 *
 * Separated from the worker so it can be exercised against a real OpenCascade
 * build in a test. The behaviour worth protecting is not that a fillet works —
 * it is what happens when one does not: the part must still be built, and the
 * feature that failed must come back with something a user can act on.
 */

/**
 * Edge hash codes are recreated every time OpenCascade replays the feature
 * tree, so persisted selections use their geometry instead.  We require both
 * the mid-point and the endpoints to agree; that makes a stale selection fail
 * safely instead of rounding a nearby parallel edge.
 */
export function edgeGeometry(edge: Shape3D['edges'][number]) {
  const start = edge.startPoint
  const end = edge.endPoint
  const middle = edge.pointAt(0.5)
  try {
    return { start: start.toTuple(), end: end.toTuple(), middle: middle.toTuple() }
  } finally {
    start.delete()
    end.delete()
    middle.delete()
  }
}

function selectedEdge(edge: Shape3D['edges'][number], references: FilletEdgeReference[], allowTrimmedSource = false) {
  const geometry = edgeGeometry(edge)
  return references.some((reference) => (allowTrimmedSource ? matchesFilletSourceEdge : matchesFilletEdge)(geometry, reference))
}

/**
 * OpenCascade is much more reliable when connected fillets are added to one
 * builder. In particular, applying them as separate operations leaves trimmed
 * tangent seams at the corner which cannot themselves be filleted. Consolidate
 * each uninterrupted run while retaining the radius assigned by each feature.
 */
export function applyFilletGroup(shape: Shape3D, operations: KernelFilletOperation[]): { shape: Shape3D; unresolved: KernelFeatureDiagnostic[] } {
  const geometries = shape.edges.map((edge) => edgeGeometry(edge))
  const matched = operations.map((operation) =>
    geometries.some((geometry) => operation.edges.some((reference) => matchesFilletSourceEdge(geometry, reference))))

  // A fillet whose edge has gone is a broken feature, not a broken part. Skip
  // it and keep building, so one stale reference cannot cost the user every
  // feature that comes after it.
  const unresolved: KernelFeatureDiagnostic[] = operations
    .filter((_, index) => !matched[index])
    .map((operation) => ({
      featureId: operation.featureId,
      featureName: operation.featureName,
      severity: 'warning' as const,
      code: 'unresolved-edge' as const,
      reason: nearestMovedEdge(operation.edges[0], geometries) ? 'moved' as const : 'missing' as const,
      subject: { kind: 'edge' as const, label: 'Selected fillet edge' },
      message: describeUnresolvedEdge(operation.featureName, operation.edges[0], geometries),
      repairs: [{ kind: 'reselect-edge' as const, label: 'Reselect edges' }],
    }))

  const applicable = operations.filter((_, index) => matched[index])
  if (!applicable.length) return { shape, unresolved }

  const attempt = filletAttempt(shape, applicable)
  const filleted = attempt(1)
  if (filleted) return { shape: filleted, unresolved }

  // The radii asked for are too large for this geometry. Rather than failing
  // the part — which would cost the user every feature after this one for the
  // sake of one number — find what would have worked and say so.
  const usable = largestWorkingScale((scale) => {
    const probe = attempt(scale)
    probe?.delete()
    return probe !== null
  })
  unresolved.push(...applicable.map((operation) => ({
    featureId: operation.featureId,
    featureName: operation.featureName,
    severity: 'warning' as const,
    code: 'oversized-fillet' as const,
    reason: 'limit-exceeded' as const,
    subject: { kind: 'parameter' as const, label: 'Fillet radius' },
    message: describeOversizedFillet(operation.featureName, operation.radius, usable, applicable.length),
    repairs: usable >= FILLET_SCALE_TOLERANCE * 2
      ? [{ kind: 'apply-radius' as const, label: 'Apply suggested radius', value: recommendedRadius(operation.radius, usable) }]
      : [{ kind: 'reselect-edge' as const, label: 'Reselect edges' }],
    ...(usable >= FILLET_SCALE_TOLERANCE * 2 ? { suggestedRadius: recommendedRadius(operation.radius, usable) } : {}),
  })))
  return { shape, unresolved }
}

/** Keep the machine-readable repair value identical to the value quoted to the user. */
function recommendedRadius(radius: number, scale: number): number {
  const limit = radius * scale
  return Number(limit >= 1 ? limit.toFixed(2) : limit.toFixed(3))
}

/**
 * A way to try this fillet group at some fraction of its radii, reporting
 * whether OpenCascade accepted it.
 *
 * Scaling every radius by one factor keeps the relative sizes the user chose,
 * which matters when a run carries fillets of different radii: shrinking them
 * together is the same design, smaller.
 */
function filletAttempt(shape: Shape3D, applicable: KernelFilletOperation[]) {
  return (scale: number): Shape3D | null => {
    try {
      return shape.fillet((edge) => {
        // A later feature wins if the same source edge was deliberately
        // selected more than once with a different radius.
        for (let index = applicable.length - 1; index >= 0; index -= 1) {
          if (selectedEdge(edge, applicable[index].edges, true)) return applicable[index].radius * scale
        }
        return null
      })
    } catch {
      return null
    }
  }
}
