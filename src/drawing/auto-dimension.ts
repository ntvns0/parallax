import { boundsCenter, boundsSize, counterClockwiseSpan } from './curve-geometry'
import type { Bounds2, DrawingDimension, Point2, ProjectedCurve, ProjectedView } from './drawing-types'
import { DIMENSION_STEP, FIRST_DIMENSION_OFFSET } from './sheet-format'

export type DimensionOptions = {
  /** Turns a millimetre value into the text printed on the sheet. */
  formatValue: (millimetres: number) => string
  /** How many stacked position dimensions to allow per side before stopping. */
  maxPositionDimensions?: number
}

const DEFAULT_MAX_POSITION_DIMENSIONS = 3
/** Coordinates closer than this are treated as the same feature line. */
const GROUPING_TOLERANCE = 1e-3
/** Share of the view an outline edge must span before it counts as a step. */
const STEP_EDGE_FRACTION = 0.25
/** How far clear of the outline a step must sit to count as a feature. */
const STEP_EDGE_MARGIN = 0.05
/**
 * How many callouts of each kind one view may carry.
 *
 * Every fillet radius in the model is already listed in the sheet notes, so a
 * view only needs to point at the ones a reader would otherwise have to guess
 * at. Past two or three, leader text crowds the view it is describing and the
 * drawing gets harder to read for saying more.
 */
const MAX_DIAMETER_CALLOUTS = 3
const MAX_RADIUS_CALLOUTS = 2

function circlesIn(view: ProjectedView): Extract<ProjectedCurve, { type: 'circle' }>[] {
  return [...view.visible, ...view.hidden].filter(
    (curve): curve is Extract<ProjectedCurve, { type: 'circle' }> => curve.type === 'circle')
}

/**
 * Arcs worth calling out with a radius.
 *
 * Only visible arcs qualify. A fillet seen through material is not what the
 * radius describes, and calling one out from a hidden line would point the
 * reader at a curve they cannot see.
 */
function arcsIn(view: ProjectedView): Extract<ProjectedCurve, { type: 'arc' }>[] {
  return view.visible.filter((curve): curve is Extract<ProjectedCurve, { type: 'arc' }> => curve.type === 'arc')
}

function groupByValue<T>(items: T[], value: (item: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>()
  for (const item of items) {
    const key = Math.round(value(item) / GROUPING_TOLERANCE) * GROUPING_TOLERANCE
    const existing = groups.get(key)
    if (existing) existing.push(item)
    else groups.set(key, [item])
  }
  return groups
}

/**
 * The circle that forms the whole outline of the view, if there is one.
 *
 * A turned part seen down its axis is fully described by one diameter, and
 * boxing it with a width and a height would say the same thing twice while
 * implying corners the part does not have.
 */
function roundOutline(view: ProjectedView): Extract<ProjectedCurve, { type: 'circle' }> | null {
  if (!view.bounds) return null
  const [width, height] = boundsSize(view.bounds)
  if (Math.abs(width - height) > GROUPING_TOLERANCE) return null
  return view.visible.find(
    (curve): curve is Extract<ProjectedCurve, { type: 'circle' }> =>
      curve.type === 'circle' && Math.abs(curve.radius * 2 - width) <= GROUPING_TOLERANCE) ?? null
}

/** Snap a leader to the nearest 45°, so callouts across a sheet stay tidy. */
function leaderAngle(from: Point2, to: Point2): number {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  if (Math.hypot(dx, dy) < GROUPING_TOLERANCE) return Math.PI / 4
  return Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
}

const BASE_LEADER = 9
/** Extra leader length for each callout already leaving in the same direction. */
const LEADER_STEP = 8

/**
 * Preferred leader directions, in order.
 *
 * Dimensions always stack off the left and bottom of a view, so callouts try
 * the right-hand diagonals first and only cross to the left when both are
 * taken. Pointing them at the busiest corner of the sheet would undo the
 * spacing the dimension stack was given.
 */
const LEADER_DIRECTIONS = [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]

/**
 * Keeps callouts in one view from landing on top of each other.
 *
 * A part with a counterbore and two fillet sizes produces several callouts that
 * all want to leave the middle of the view diagonally, and stacked leader text
 * is worse than no text at all. Diameters are free to take any spare corner;
 * radii must keep the direction that puts their arrowhead on the arc, so they
 * are pushed further out along the same line instead.
 */
function calloutPlacer() {
  const used = new Map<number, number>()
  const key = (angle: number) => Math.round(normalise(angle) / (Math.PI / 4))
  const take = (angle: number) => {
    const count = used.get(key(angle)) ?? 0
    used.set(key(angle), count + 1)
    return { angle, leader: BASE_LEADER + count * LEADER_STEP }
  }

  return {
    /** Takes the first free preferred direction, falling back to `preferred`. */
    free(preferred: number) {
      for (const candidate of LEADER_DIRECTIONS) {
        if (!used.has(key(candidate))) return take(candidate)
      }
      return take(preferred)
    },
    /** Keeps the direction and moves the text further out if it is crowded. */
    fixed(angle: number) {
      return take(angle)
    },
  }
}

/**
 * Where a radius leader leaves its arc.
 *
 * Snapping to a diagonal lines callouts up with each other, but only when the
 * arc actually reaches that far — otherwise the arrowhead would point at a
 * curve that is not there, and the middle of the arc is used instead.
 */
function arcLeaderAngle(arc: Extract<ProjectedCurve, { type: 'arc' }>): number {
  const middle = (arc.startAngle + arc.endAngle) / 2
  const snapped = Math.round(middle / (Math.PI / 4)) * (Math.PI / 4)
  const withinArc = counterClockwiseSpan(arc.startAngle, snapped) <= arc.endAngle - arc.startAngle
  return withinArc ? snapped : middle
}

function normalise(angle: number): number {
  const wrapped = angle % (Math.PI * 2)
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped
}

/**
 * Derive the dimensions a view should carry.
 *
 * The scheme is the one a drafter would start from: overall size first, then
 * every distinct hole diameter called out once with a count, then the hole
 * positions measured from a single datum corner. Measuring every hole from the
 * same two edges — rather than chaining hole to hole — is what stops tolerances
 * accumulating across the part when it is actually made.
 *
 * It is a starting point and says so on the sheet. It cannot know which
 * dimensions carry the design intent, so it never claims to be a tolerance
 * scheme.
 */
export function autoDimensionView(view: ProjectedView, options: DimensionOptions): DrawingDimension[] {
  if (!view.bounds || view.id === 'iso') return []

  const { formatValue } = options
  const maxPositions = options.maxPositionDimensions ?? DEFAULT_MAX_POSITION_DIMENSIONS
  const dimensions: DrawingDimension[] = []
  const bounds = view.bounds
  const [width, height] = boundsSize(bounds)
  const centre = boundsCenter(bounds)
  const outline = roundOutline(view)
  const round = outline !== null

  let horizontalLevel = 0
  let verticalLevel = 0
  const horizontalOffset = () => FIRST_DIMENSION_OFFSET + DIMENSION_STEP * horizontalLevel++
  const verticalOffset = () => FIRST_DIMENSION_OFFSET + DIMENSION_STEP * verticalLevel++

  if (!round && width > GROUPING_TOLERANCE) {
    dimensions.push({
      kind: 'linear',
      axis: 'horizontal',
      from: [bounds.min[0], bounds.min[1]],
      to: [bounds.max[0], bounds.min[1]],
      offset: horizontalOffset(),
      text: formatValue(width),
    })
  }
  if (!round && height > GROUPING_TOLERANCE) {
    dimensions.push({
      kind: 'linear',
      axis: 'vertical',
      from: [bounds.min[0], bounds.min[1]],
      to: [bounds.min[0], bounds.max[1]],
      offset: verticalOffset(),
      text: formatValue(height),
    })
  }

  const circles = circlesIn(view)
  const callouts = calloutPlacer()

  // One callout per distinct diameter, carrying the count. Four identical holes
  // want "4× Ø6" once, not the same number written four times.
  const diameterGroups = [...groupByValue(circles, (circle) => circle.radius)]
    .sort((a, b) => b[0] - a[0])
    .slice(0, MAX_DIAMETER_CALLOUTS)
  for (const [, group] of diameterGroups) {
    const representative = group[0]
    const diameter = formatValue(representative.radius * 2)
    dimensions.push({
      kind: 'diameter',
      center: representative.center,
      radius: representative.radius,
      ...callouts.free(leaderAngle(centre, representative.center)),
      text: group.length > 1 ? `${group.length}× Ø${diameter}` : `Ø${diameter}`,
    })
  }

  // One radius callout per distinct arc size. This is how a fillet gets stated:
  // "R3", not a diameter, which would be read as a hole.
  const radiusGroups = [...groupByValue(arcsIn(view), (arc) => arc.radius)]
    .sort((a, b) => b[0] - a[0])
    .slice(0, MAX_RADIUS_CALLOUTS)
  for (const [, group] of radiusGroups) {
    const representative = group[0]
    const radius = formatValue(representative.radius)
    dimensions.push({
      kind: 'radius',
      center: representative.center,
      radius: representative.radius,
      // Out through the arc, which is where the radius is actually being
      // measured to, snapped to a diagonal when the arc is wide enough to keep
      // the arrowhead on it.
      ...callouts.fixed(arcLeaderAngle(representative)),
      text: group.length > 1 ? `${group.length}× R${radius}` : `R${radius}`,
    })
  }

  // Feature positions, measured from one datum corner. Hole centres and the
  // steps in the outline are treated alike: both are things a maker has to
  // locate, and grouping them by shared centre line means a rectangular pattern
  // needs two dimensions per axis rather than one per feature.
  //
  // A feature on the axis of a round part is left out: its diameter already
  // locates it, and measuring to a bounding corner the part does not have
  // would be noise.
  const positioned = outline
    ? circles.filter((circle) =>
        Math.hypot(circle.center[0] - outline.center[0], circle.center[1] - outline.center[1]) > GROUPING_TOLERANCE)
    : circles

  // Hole centres come before outline steps, so that when the cap bites it is a
  // step that is dropped rather than the position of a hole someone has to
  // drill.
  const steps = stepPositions(view, bounds)
  const columnKeys = orderedKeys(
    [...positioned.map((circle) => circle.center[0]), ...steps.vertical],
    bounds.min[0],
    bounds.max[0],
    maxPositions,
  )
  for (const x of columnKeys) {
    dimensions.push({
      kind: 'linear',
      axis: 'horizontal',
      from: [bounds.min[0], bounds.min[1]],
      to: [x, bounds.min[1]],
      offset: horizontalOffset(),
      text: formatValue(x - bounds.min[0]),
    })
  }

  const rowKeys = orderedKeys(
    [...positioned.map((circle) => circle.center[1]), ...steps.horizontal],
    bounds.min[1],
    bounds.max[1],
    maxPositions,
  )
  for (const y of rowKeys) {
    dimensions.push({
      kind: 'linear',
      axis: 'vertical',
      from: [bounds.min[0], bounds.min[1]],
      to: [bounds.min[0], y],
      offset: verticalOffset(),
      text: formatValue(y - bounds.min[1]),
    })
  }

  return dimensions
}

/**
 * Distinct, sorted feature positions, capped to keep a view readable.
 *
 * Positions at either end of the view are dropped: the far edge is already
 * stated by the overall dimension, and repeating it invites the reader to treat
 * two numbers for the same distance as two separate requirements.
 */
function orderedKeys(values: number[], datum: number, far: number, limit: number): number[] {
  const keys = [...groupByValue(values, (value) => value).keys()]
    .filter((value) => Math.abs(value - datum) > GROUPING_TOLERANCE && Math.abs(value - far) > GROUPING_TOLERANCE)
    .sort((a, b) => a - b)
  return keys.slice(0, limit)
}

/**
 * Where the outline steps in or out.
 *
 * A straight edge running across the view — the wall of a pocket, the face of a
 * shoulder — is a feature someone has to position, and on a stepped part it is
 * usually the dimension that matters most. Only edges long enough to be
 * structural are counted, so a fillet's tangent stub or a chamfer's short face
 * does not earn its own dimension line.
 */
function stepPositions(view: ProjectedView, bounds: Bounds2): { vertical: number[]; horizontal: number[] } {
  const [width, height] = boundsSize(bounds)
  const vertical: number[] = []
  const horizontal: number[] = []

  // A fillet or chamfer leaves a straight edge running just inside the outline.
  // It is a real edge but not a feature anyone positions, and dimensioning it
  // repeats what the radius callout already says.
  const clearsEdges = (value: number, min: number, max: number, extent: number) => {
    const margin = Math.max(2, extent * STEP_EDGE_MARGIN)
    return value - min > margin && max - value > margin
  }

  for (const curve of view.visible) {
    if (curve.type !== 'segment') continue
    const run = Math.abs(curve.end[0] - curve.start[0])
    const rise = Math.abs(curve.end[1] - curve.start[1])

    if (run <= GROUPING_TOLERANCE && rise >= height * STEP_EDGE_FRACTION) {
      if (clearsEdges(curve.start[0], bounds.min[0], bounds.max[0], width)) vertical.push(curve.start[0])
    } else if (rise <= GROUPING_TOLERANCE && run >= width * STEP_EDGE_FRACTION) {
      if (clearsEdges(curve.start[1], bounds.min[1], bounds.max[1], height)) horizontal.push(curve.start[1])
    }
  }

  return { vertical, horizontal }
}

/**
 * How far a view's dimensions reach beyond the geometry, in sheet millimetres.
 *
 * The layout needs this before it can choose a scale: a view with four stacked
 * position dimensions needs far more room below it than a plain outline, and
 * guessing a fixed margin either wastes paper or lets the outermost dimension
 * collide with the view's own caption.
 */
export function annotationExtent(dimensions: DrawingDimension[]): { left: number; bottom: number } {
  let left = 0
  let bottom = 0
  for (const dimension of dimensions) {
    if (dimension.kind !== 'linear') continue
    if (dimension.axis === 'vertical') left = Math.max(left, dimension.offset)
    else bottom = Math.max(bottom, dimension.offset)
  }
  return { left, bottom }
}

/**
 * Cross marks at the centre of every circle.
 *
 * The arms run slightly past the circle, which is the convention, and gives the
 * reader something to measure a hole position from by eye.
 */
export function centerMarkCurves(view: ProjectedView): ProjectedCurve[] {
  return circlesIn(view).flatMap((circle) => {
    const arm = circle.radius * 1.25
    const [x, y] = circle.center
    return [
      { type: 'segment', start: [x - arm, y], end: [x + arm, y] },
      { type: 'segment', start: [x, y - arm], end: [x, y + arm] },
    ] satisfies ProjectedCurve[]
  })
}
