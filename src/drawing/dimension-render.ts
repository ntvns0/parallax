import type { DrawingDimension, Point2, SheetPrimitive } from './drawing-types'
import { textWidth } from './helvetica-metrics'
import { pointOnCircle } from './curve-geometry'
import {
  ARROW_HALF_WIDTH,
  ARROW_LENGTH,
  EXTENSION_GAP,
  EXTENSION_OVERSHOOT,
  TEXT_SIZES,
} from './sheet-format'
import { transformPoint, type ViewPlacement } from './view-layout'

/** Gap between a dimension line and the text sitting on it. */
const TEXT_LIFT = 1.1

/**
 * A solid arrowhead with its tip at `tip`, pointing along `direction`.
 *
 * `direction` is the way the arrow points, so the body is built backwards from
 * the tip.
 */
function arrowhead(tip: Point2, direction: Point2, role: SheetPrimitive['role'] = 'dimension'): SheetPrimitive {
  const length = Math.hypot(direction[0], direction[1]) || 1
  const unit: Point2 = [direction[0] / length, direction[1] / length]
  const perpendicular: Point2 = [-unit[1], unit[0]]
  const base: Point2 = [tip[0] - unit[0] * ARROW_LENGTH, tip[1] - unit[1] * ARROW_LENGTH]
  return {
    kind: 'fill',
    role,
    points: [
      tip,
      [base[0] + perpendicular[0] * ARROW_HALF_WIDTH, base[1] + perpendicular[1] * ARROW_HALF_WIDTH],
      [base[0] - perpendicular[0] * ARROW_HALF_WIDTH, base[1] - perpendicular[1] * ARROW_HALF_WIDTH],
    ],
  }
}

/**
 * Draw one linear dimension.
 *
 * Horizontal dimensions are placed below the points they measure and vertical
 * ones to their left, matching where `auto-dimension` anchors them. Vertical
 * text is rotated to read from the right-hand side of the sheet, which is the
 * ISO convention and means a drawing only ever has to be turned one way.
 */
function renderLinear(
  dimension: Extract<DrawingDimension, { kind: 'linear' }>,
  placement: ViewPlacement,
): SheetPrimitive[] {
  const from = transformPoint(placement, dimension.from)
  const to = transformPoint(placement, dimension.to)
  const horizontal = dimension.axis === 'horizontal'

  // The axis the dimension runs along, and the axis it is pushed out along.
  const along = horizontal ? 0 : 1
  const across = horizontal ? 1 : 0

  const lineAcross = Math.min(from[across], to[across]) - dimension.offset
  const start = Math.min(from[along], to[along])
  const end = Math.max(from[along], to[along])
  const span = end - start

  const at = (alongValue: number, acrossValue: number): Point2 =>
    (horizontal ? [alongValue, acrossValue] : [acrossValue, alongValue])

  const primitives: SheetPrimitive[] = []

  // Witness lines stop short of the geometry and run just past the dimension
  // line, so the reader can tell what is being measured from what is drawn.
  for (const anchor of [from, to]) {
    const gapStart = anchor[across] - EXTENSION_GAP
    primitives.push({
      kind: 'path',
      role: 'dimension',
      points: [at(anchor[along], gapStart), at(anchor[along], lineAcross - EXTENSION_OVERSHOOT)],
    })
  }

  primitives.push({ kind: 'path', role: 'dimension', points: [at(start, lineAcross), at(end, lineAcross)] })

  // Arrows point outwards from inside the span, unless the span is too short to
  // hold them, in which case they sit outside pointing in.
  const insideArrows = span >= ARROW_LENGTH * 2.4
  const direction: Point2 = horizontal ? [1, 0] : [0, 1]
  const negative: Point2 = horizontal ? [-1, 0] : [0, -1]
  if (insideArrows) {
    primitives.push(arrowhead(at(start, lineAcross), negative))
    primitives.push(arrowhead(at(end, lineAcross), direction))
  } else {
    primitives.push(arrowhead(at(start, lineAcross), direction))
    primitives.push(arrowhead(at(end, lineAcross), negative))
    // Give the arrows something to sit on when they hang outside the span.
    primitives.push({
      kind: 'path',
      role: 'dimension',
      points: [at(start - ARROW_LENGTH * 2, lineAcross), at(end + ARROW_LENGTH * 2, lineAcross)],
    })
  }

  const size = TEXT_SIZES.dimension
  const width = textWidth(dimension.text, size)
  const centre = (start + end) / 2
  const fits = span >= width + (insideArrows ? ARROW_LENGTH * 2 : 0)
  const textAlong = fits ? centre : end + ARROW_LENGTH * 2 + width / 2 + 1

  // The value sits clear of the dimension line, on the side facing the part.
  // Rotated text grows away from its baseline rather than upwards from it, so a
  // vertical dimension needs the cap height added or the digits are drawn
  // straddling the line they belong to.
  const textAcross = lineAcross + TEXT_LIFT + (horizontal ? 0 : size)

  primitives.push({
    kind: 'text',
    role: 'dimension',
    at: at(textAlong, textAcross),
    text: dimension.text,
    size,
    anchor: 'middle',
    baseline: 'bottom',
    rotation: horizontal ? 0 : 90,
  })

  return primitives
}

/**
 * Draw a diameter or radius callout as a leader off the curve.
 *
 * The leader starts on the curve itself rather than at its centre, so a pattern
 * of holes stays readable when several callouts leave the same area. Both kinds
 * are drawn the same way; only the text differs, and that is decided where the
 * dimension is created.
 */
function renderCallout(
  dimension: Extract<DrawingDimension, { kind: 'diameter' | 'radius' }>,
  placement: ViewPlacement,
): SheetPrimitive[] {
  const centre = transformPoint(placement, dimension.center)
  const radius = dimension.radius * placement.scale
  const touch = pointOnCircle(centre, radius, dimension.angle)
  const elbow: Point2 = [
    touch[0] + Math.cos(dimension.angle) * dimension.leader,
    touch[1] + Math.sin(dimension.angle) * dimension.leader,
  ]

  const pointsRight = Math.cos(dimension.angle) >= 0
  const shelfLength = textWidth(dimension.text, TEXT_SIZES.dimension) + 1.5
  const shelfEnd: Point2 = [elbow[0] + (pointsRight ? shelfLength : -shelfLength), elbow[1]]

  return [
    { kind: 'path', role: 'dimension', points: [touch, elbow, shelfEnd] },
    arrowhead(touch, [Math.cos(dimension.angle + Math.PI), Math.sin(dimension.angle + Math.PI)]),
    {
      kind: 'text',
      role: 'dimension',
      at: [elbow[0] + (pointsRight ? 1.2 : -1.2), elbow[1] + 1],
      text: dimension.text,
      size: TEXT_SIZES.dimension,
      anchor: pointsRight ? 'start' : 'end',
      baseline: 'bottom',
    },
  ]
}

export function renderDimension(dimension: DrawingDimension, placement: ViewPlacement): SheetPrimitive[] {
  return dimension.kind === 'linear' ? renderLinear(dimension, placement) : renderCallout(dimension, placement)
}
