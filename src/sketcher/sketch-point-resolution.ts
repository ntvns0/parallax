import { snapToFaceReference, snapToReferenceGeometry, type ReferenceGeometry } from '../core/face-reference'
import type { DisplayUnits, LineEntity, SketchFaceAttachment, Vec2 } from '../core/model'
import { lineRulerAtPoint, snapToSketchLines, type LineRuler } from './entity-snap'
import type { ActiveSnap } from './sketch-geometry-builders'

/**
 * Where a pointer position lands in a sketch, once snapping has had its say.
 *
 * In order of precedence: an endpoint, midpoint, or crossing of existing
 * geometry; a division on the ruler of the line under the pointer; a point on
 * that line; a reference on the attached face; one on the part's edges
 * projected onto the sketch plane; and last, the background grid.
 * Explicit geometry carries design intent, so it beats the grid.
 *
 * Tolerances are in screen pixels and divided by the view scale, so snapping
 * feels the same at every zoom.
 */

export function snapToIncrement(value: number, increment = 1) {
  return Math.round(value / increment) * increment
}

/** Keep labelled ruler divisions readable as the view zooms in and out. */
export function adaptiveRulerMultiplier(baseSpacingPixels: number) {
  const minimum = 36
  if (baseSpacingPixels >= minimum) return 1
  const required = minimum / Math.max(baseSpacingPixels, 1e-9)
  let decade = 1
  while (decade * 10 < required) decade *= 10
  for (const step of [1, 2, 5, 10]) {
    const multiplier = decade * step
    if (multiplier >= required) return multiplier
  }
  return decade * 10
}

export type ResolvedPoint = { point: Vec2; snap: ActiveSnap | null; ruler: LineRuler | null }

export function resolveSketchPoint(options: {
  point: Vec2
  lines: LineEntity[]
  scale: number
  displayUnits: DisplayUnits
  gridIncrement: number
  rulerDatum: 'start' | 'end'
  attachment: SketchFaceAttachment | undefined
  projected?: ReferenceGeometry | null
}): ResolvedPoint {
  const { point, lines, scale, displayUnits, gridIncrement, rulerDatum, attachment, projected } = options
  const baseMajorIncrement = displayUnits === 'mm' ? 10 : 25.4
  const rulerMultiplier = adaptiveRulerMultiplier(baseMajorIncrement * scale)
  const majorIncrement = baseMajorIncrement * rulerMultiplier
  const minorIncrement = displayUnits === 'in-fractional' ? 25.4 / 16 * rulerMultiplier : majorIncrement / 10
  const ruler = lineRulerAtPoint(point, lines, 10 / scale, 6 / scale, majorIncrement, minorIncrement, rulerDatum)

  const lineSnap = snapToSketchLines(point, lines, 10 / scale)
  if (lineSnap && lineSnap.kind !== 'line') return { point: lineSnap.point, snap: { ...lineSnap, source: 'entity' }, ruler }
  if (ruler?.snap) return { point: ruler.snap.point, snap: { ...ruler.snap, source: 'entity' }, ruler }
  if (lineSnap) return { point: lineSnap.point, snap: { ...lineSnap, source: 'entity' }, ruler }

  const faceSnap = snapToFaceReference(point, attachment, 10 / scale)
  if (faceSnap) return { point: faceSnap.point, snap: { ...faceSnap, source: 'face' }, ruler }
  const projectedSnap = snapToReferenceGeometry(point, projected, 10 / scale)
  if (projectedSnap) return { point: projectedSnap.point, snap: { ...projectedSnap, source: 'projected' }, ruler }
  return { point: [snapToIncrement(point[0], gridIncrement), snapToIncrement(point[1], gridIncrement)], snap: null, ruler }
}
