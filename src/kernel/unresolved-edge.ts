import type { FilletEdgeReference } from '../core/model'

/**
 * Why a fillet could not find the edge it was placed on.
 *
 * A stored reference is three absolute coordinates, so it stops resolving for
 * two quite different reasons, and telling the user the wrong one sends them
 * hunting in the wrong place:
 *
 *  - the edge is still there but has *moved*, because the sketch or feature
 *    that created it changed — by far the common case, and the one anchored
 *    references are meant to remove entirely;
 *  - the edge is genuinely gone, because it was consumed by an earlier fillet
 *    or the geometry that formed it was deleted.
 *
 * A near-miss that is parallel to the reference and of a similar length is
 * almost certainly the same edge in a new position, so measuring the distance
 * to the closest such candidate separates the two cases without guessing.
 */

export type EdgeGeometry = { start: readonly number[]; end: readonly number[]; middle: readonly number[] }

/** How far an edge may have drifted and still be recognisable as the same one. */
const DRIFT_LIMIT_MM = 50

function distance(left: readonly number[], right: readonly number[]) {
  return Math.hypot(...left.map((value, index) => value - right[index]))
}

function direction(edge: { start: readonly number[]; end: readonly number[] }) {
  const delta = edge.end.map((value, index) => value - edge.start[index])
  const length = Math.hypot(...delta)
  return length < 1e-9 ? null : { unit: delta.map((value) => value / length), length }
}

/**
 * The closest edge that plausibly *is* the referenced one, having drifted.
 * Returns null when nothing in the solid resembles it.
 */
export function nearestMovedEdge(reference: FilletEdgeReference, edges: EdgeGeometry[]): { edge: EdgeGeometry; drift: number } | null {
  const referenceDirection = direction(reference)
  if (!referenceDirection) return null

  let best: { edge: EdgeGeometry; drift: number } | null = null
  for (const edge of edges) {
    const edgeDirection = direction(edge)
    if (!edgeDirection) continue
    // Same edge in a new place keeps its orientation and its length.
    const alignment = Math.abs(edgeDirection.unit.reduce((total, value, index) => total + value * referenceDirection.unit[index], 0))
    if (alignment < 0.999) continue
    const lengthRatio = edgeDirection.length / referenceDirection.length
    if (lengthRatio < 0.5 || lengthRatio > 2) continue
    const drift = distance(edge.middle, reference.point)
    if (drift > DRIFT_LIMIT_MM) continue
    if (!best || drift < best.drift) best = { edge, drift }
  }
  return best
}

/** Plain-language account of why one fillet could not be applied. */
export function describeUnresolvedEdge(featureName: string, reference: FilletEdgeReference, edges: EdgeGeometry[]): string {
  const moved = nearestMovedEdge(reference, edges)
  if (moved) {
    return `${featureName} could not find the edge it was placed on. A matching edge sits about ${moved.drift.toFixed(1)} mm away, so the sketch or feature that created it has moved. Reselect the edge to reattach this fillet.`
  }
  return `${featureName} could not find the edge it was placed on. That edge no longer exists — it was either removed by an earlier fillet or the geometry that formed it was deleted. Reselect an edge, or delete this fillet.`
}
