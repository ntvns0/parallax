import type { ArcLike } from '../core/arc-geometry'
import type { DisplayUnits, Vec2 } from '../core/model'
import { formatLength } from '../core/units'
import type { DrawingPreviewState } from './sketch-drawing-preview'
import { distance } from './sketch-geometry-builders'

/** The text beside the cursor: what the next click will do, or what it is measuring. */

export function lineAngle(start: Vec2, end: Vec2) {
  return Math.atan2(end[1] - start[1], end[0] - start[0])
}

/** Radians to degrees in (-180, 180]. */
export function normalizeDegrees(radians: number) {
  let degrees = radians * 180 / Math.PI
  while (degrees > 180) degrees -= 360
  while (degrees <= -180) degrees += 360
  return degrees
}

const sweepDegrees = (arc: ArcLike) => ((arc.endAngle - arc.startAngle) * 180) / Math.PI

export function sketchReadout(state: DrawingPreviewState, units: DisplayUnits): string | null {
  const { tool, cursor, start, previewEnd } = state
  if (!cursor) return null
  if (state.pendingArcPreview) {
    return `R ${formatLength(state.pendingArcPreview.radius, units)}   ∠ ${sweepDegrees(state.pendingArcPreview).toFixed(1)}°`
  }
  if (state.pendingArc) return 'Choose the arc end point'
  if (tool === 'arc' && start) return `Choose radius/start point   R ${formatLength(distance(start, cursor), units)}`
  if (state.threePointArcPreview) {
    return `R ${formatLength(state.threePointArcPreview.radius, units)}   ∠ ${sweepDegrees(state.threePointArcPreview).toFixed(1)}°`
  }
  if (state.pendingThreePointArc) return state.pendingThreePointArc.end ? 'Choose a point on the arc' : 'Choose the arc end point'
  if (state.tangentArcPreview) return `R ${formatLength(state.tangentArcPreview.radius, units)}   tangent`
  if (tool === 'tangent-arc') return state.pendingTangentArc ? 'Choose the arc end point' : 'Choose a line or arc endpoint'
  if (tool === 'trim') return state.trimPreview ? 'Click to remove the highlighted piece' : 'Hover a curve to trim it back to a crossing'
  if (!start || !previewEnd) return `X ${formatLength(cursor[0], units)}   Y ${formatLength(cursor[1], units)}`
  if (tool === 'circle' || tool === 'arc') return `R ${formatLength(distance(start, previewEnd), units)}`
  if (tool === 'rectangle') {
    return `W ${formatLength(Math.abs(previewEnd[0] - start[0]), units)}   H ${formatLength(Math.abs(previewEnd[1] - start[1]), units)}`
  }
  return `L ${formatLength(distance(start, previewEnd), units)}   ∠ ${normalizeDegrees(lineAngle(start, previewEnd)).toFixed(1)}°`
}
