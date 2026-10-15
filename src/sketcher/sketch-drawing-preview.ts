import { arcFromCenterAndPoints, arcFromThreePoints, tangentArcFromEndpoint, type ArcLike } from '../core/arc-geometry'
import type { Vec2 } from '../core/model'
import { inferredLineAngle, snapLineEnd } from './line-inference'
import type { AngleSnap } from './sketch-tools'
import type { TangentArcSource } from './tangent-arc'

/**
 * What the active tool would add if the pointer were released or clicked now.
 *
 * Both the preview drawing and the cursor readout are read from this, so what
 * the readout says and what the surface shows cannot disagree.
 */

export type DrawingGesture = {
  tool: string
  /** Where a two-point gesture began, or a centre-point arc's centre before its radius is chosen. */
  start: Vec2 | null
  cursor: Vec2 | null
  /** Whether the cursor sits on a snap target, which beats angle inference. */
  snapped: boolean
  angleSnap: AngleSnap
  gridIncrement: number
  /** Degrees within which smart angle inference acquires a direction. */
  angleTolerance: number
  trimPreview: Vec2[] | null
  /** A centre-point arc with its centre and radius chosen, waiting for its sweep. */
  pendingArc: { center: Vec2; start: Vec2 } | null
  pendingThreePointArc: { start: Vec2; end?: Vec2 } | null
  pendingTangentArc: TangentArcSource | null
}

export type DrawingPreviewState = Omit<DrawingGesture, 'snapped' | 'angleSnap' | 'gridIncrement' | 'angleTolerance'> & {
  /** Where the gesture would end: the cursor, or for a line, where inference would put the end. */
  previewEnd: Vec2 | null
  /** The angle a line would be held at, when inference has acquired one. */
  previewAngleSnap: number | null
  pendingArcPreview: ArcLike | null
  threePointArcPreview: ArcLike | null
  tangentArcPreview: ArcLike | null
}

export function drawingPreview(gesture: DrawingGesture): DrawingPreviewState {
  const { tool, start, cursor, snapped, angleSnap, gridIncrement, angleTolerance } = gesture
  const { pendingArc, pendingThreePointArc, pendingTangentArc } = gesture
  const drawingLine = tool === 'line' && start !== null && cursor !== null
  const previewEnd = drawingLine && !snapped ? snapLineEnd(start, cursor, angleSnap, gridIncrement, angleTolerance) : cursor
  return {
    tool,
    start,
    cursor,
    trimPreview: gesture.trimPreview,
    pendingArc,
    pendingThreePointArc,
    pendingTangentArc,
    previewEnd,
    previewAngleSnap: drawingLine && previewEnd ? inferredLineAngle(start, previewEnd, angleSnap, snapped, angleTolerance) : null,
    pendingArcPreview: pendingArc && cursor ? arcFromCenterAndPoints(pendingArc.center, pendingArc.start, cursor) : null,
    threePointArcPreview: pendingThreePointArc?.end && cursor
      ? arcFromThreePoints(pendingThreePointArc.start, pendingThreePointArc.end, cursor)
      : null,
    tangentArcPreview: pendingTangentArc && cursor
      ? tangentArcFromEndpoint(pendingTangentArc.point, cursor, pendingTangentArc.tangent)
      : null,
  }
}
