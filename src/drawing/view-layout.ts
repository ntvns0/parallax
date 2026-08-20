import { boundsCenter, boundsSize } from './curve-geometry'
import type { Bounds2, DrawingViewId, Point2, ProjectedView } from './drawing-types'
import { STANDARD_SCALES, VIEW_GUTTER, VIEW_PADDING_BASE } from './sheet-format'

/** Clearance reserved around one view, in sheet millimetres. */
export type ViewPadding = { left: number; right: number; top: number; bottom: number }

/** How much room a given view needs around it. Supplied by the sheet builder. */
export type PaddingLookup = (id: DrawingViewId) => ViewPadding

/**
 * Where one view ends up on the sheet.
 *
 * `sheetPoint = viewPoint * scale + offset` converts anything measured in the
 * projection into paper coordinates.
 */
export type ViewPlacement = {
  id: DrawingViewId
  scale: number
  offset: Point2
  /** The view's own extent, in view millimetres. */
  bounds: Bounds2
  /** The whole cell the view was given, in sheet millimetres, padding included. */
  cell: Bounds2
}

export type ViewLayout = {
  scale: number
  placements: ViewPlacement[]
}

/**
 * The third-angle grid.
 *
 * Top sits above front and right sits beside it, which is what third-angle
 * projection means: each view is placed on the side of the front view that you
 * would have to walk round to in order to see it. The isometric takes the one
 * remaining corner, where it explains the part without being mistaken for a
 * projected view.
 */
const VIEW_CELLS: Record<Exclude<DrawingViewId, 'section'>, { column: 0 | 1; row: 0 | 1 }> = {
  front: { column: 0, row: 0 },
  right: { column: 1, row: 0 },
  top: { column: 0, row: 1 },
  iso: { column: 1, row: 1 },
}

/**
 * A section takes the place of the view it was cut in the direction of.
 *
 * That is the drafting convention for a full section — the cut view replaces
 * the exterior one rather than being added beside it — and it keeps the section
 * in projection with its neighbours, which is what lets a reader carry a
 * feature across from the views next to it.
 */
function cellFor(view: ProjectedView) {
  return VIEW_CELLS[view.section ? view.section.parent : (view.id as Exclude<DrawingViewId, 'section'>)]
}

export function transformPoint(placement: ViewPlacement, point: Point2): Point2 {
  return [point[0] * placement.scale + placement.offset[0], point[1] * placement.scale + placement.offset[1]]
}

/**
 * Padding per column and per row, taken as the largest any view in it needs.
 *
 * Two views sharing a column share the margin down its side, so the column has
 * to satisfy the more demanding of them or the busier view's dimensions would
 * spill into its neighbour.
 */
function gridPadding(views: ProjectedView[], padding: PaddingLookup) {
  const columns = [
    { left: 0, right: 0 },
    { left: 0, right: 0 },
  ]
  const rows = [
    { top: 0, bottom: 0 },
    { top: 0, bottom: 0 },
  ]
  for (const view of views) {
    if (!view.bounds) continue
    const cell = cellFor(view)
    const needed = padding(view.id)
    columns[cell.column].left = Math.max(columns[cell.column].left, needed.left)
    columns[cell.column].right = Math.max(columns[cell.column].right, needed.right)
    rows[cell.row].top = Math.max(rows[cell.row].top, needed.top)
    rows[cell.row].bottom = Math.max(rows[cell.row].bottom, needed.bottom)
  }
  return { columns, rows }
}

/**
 * How much smaller the pictorial view is drawn than the projected ones.
 *
 * An isometric of a box is about half again as wide as the box, so drawing it
 * at the sheet scale costs more paper than the view it explains. Halving it
 * keeps it clearly legible while making it plain that it is not the view to
 * measure from — and it is captioned with its own scale so nobody tries.
 */
const PICTORIAL_SCALE_DIVISOR = 2

export function scaleForView(id: DrawingViewId, sheetScale: number): number {
  if (id !== 'iso') return sheetScale
  return STANDARD_SCALES.find((candidate) => candidate <= sheetScale / PICTORIAL_SCALE_DIVISOR)
    ?? STANDARD_SCALES[STANDARD_SCALES.length - 1]
}

/**
 * Sheet-space extent of each grid column and row, so views stay projection-aligned.
 *
 * Each view contributes at the scale it will actually be drawn at, which is how
 * the isometric can be given a cell that fits it without dragging the scale of
 * everything else down with it.
 */
function gridExtents(views: ProjectedView[], sheetScale: number) {
  const columns = [0, 0]
  const rows = [0, 0]
  for (const view of views) {
    if (!view.bounds) continue
    const [width, height] = boundsSize(view.bounds)
    const scale = scaleForView(view.id, sheetScale)
    const cell = cellFor(view)
    columns[cell.column] = Math.max(columns[cell.column], width * scale)
    rows[cell.row] = Math.max(rows[cell.row], height * scale)
  }
  return { columns, rows }
}

function occupied(views: ProjectedView[]) {
  const columns = [false, false]
  const rows = [false, false]
  for (const view of views) {
    if (!view.bounds) continue
    const cell = cellFor(view)
    columns[cell.column] = true
    rows[cell.row] = true
  }
  return { columns, rows }
}

/**
 * The paper a set of views needs at a given scale.
 *
 * Padding is added per occupied column and row rather than per view, because
 * two views sharing a column share the annotation margin down its side.
 */
function requiredSize(views: ProjectedView[], scale: number, padding: PaddingLookup): Point2 {
  const { columns, rows } = gridExtents(views, scale)
  const present = occupied(views)
  const grid = gridPadding(views, padding)

  let width = 0
  let height = 0
  let columnCount = 0
  let rowCount = 0
  for (const index of [0, 1]) {
    if (present.columns[index]) {
      width += columns[index] + grid.columns[index].left + grid.columns[index].right
      columnCount += 1
    }
    if (present.rows[index]) {
      height += rows[index] + grid.rows[index].top + grid.rows[index].bottom
      rowCount += 1
    }
  }
  return [
    width + Math.max(0, columnCount - 1) * VIEW_GUTTER,
    height + Math.max(0, rowCount - 1) * VIEW_GUTTER,
  ]
}

/**
 * The largest preferred scale whose views still fit the area.
 *
 * Falls back to the smallest preferred scale rather than to an arbitrary
 * fitted number: a sheet that has run out of room should say 1:200 and overflow
 * visibly, not print an unmeasurable 1:237 that looks correct.
 */
export function chooseScale(views: ProjectedView[], area: Bounds2, padding: PaddingLookup): number {
  const [availableWidth, availableHeight] = boundsSize(area)
  for (const scale of STANDARD_SCALES) {
    const [width, height] = requiredSize(views, scale, padding)
    if (width <= availableWidth && height <= availableHeight) return scale
  }
  return STANDARD_SCALES[STANDARD_SCALES.length - 1]
}

/** Padding for a view carrying no dimensions at all. */
export function plainPadding(extra: Partial<ViewPadding> = {}): ViewPadding {
  return { ...VIEW_PADDING_BASE, ...extra }
}


/**
 * Place every view in the drawing area at a common scale.
 *
 * One scale for all views is deliberate: views drawn at different scales cannot
 * be compared by eye or checked against each other, and the alignment between
 * front, top and right is the reader's main tool for understanding the part.
 */
export function layoutViews(
  views: ProjectedView[],
  area: Bounds2,
  options: { padding: PaddingLookup; scale?: number | null },
): ViewLayout {
  const drawable = views.filter((view) => view.bounds !== null)

  const scale = options.scale ?? chooseScale(drawable, area, options.padding)
  const grid = gridPadding(drawable, options.padding)
  const { columns, rows } = gridExtents(drawable, scale)
  const present = occupied(drawable)

  const columnWidths = [0, 1].map((index) =>
    present.columns[index] ? columns[index] + grid.columns[index].left + grid.columns[index].right : 0)
  const rowHeights = [0, 1].map((index) =>
    present.rows[index] ? rows[index] + grid.rows[index].top + grid.rows[index].bottom : 0)

  const gridWidth = columnWidths.reduce((total, width) => total + width, 0)
    + (present.columns[0] && present.columns[1] ? VIEW_GUTTER : 0)
  const gridHeight = rowHeights.reduce((total, height) => total + height, 0)
    + (present.rows[0] && present.rows[1] ? VIEW_GUTTER : 0)

  // Centre the whole grid in the drawing area, so a two-view sheet does not sit
  // hard against one corner.
  const [areaWidth, areaHeight] = boundsSize(area)
  const gridLeft = area.min[0] + Math.max(0, (areaWidth - gridWidth) / 2)
  const gridBottom = area.min[1] + Math.max(0, (areaHeight - gridHeight) / 2)

  const columnLeft = [gridLeft, gridLeft + columnWidths[0] + (present.columns[0] ? VIEW_GUTTER : 0)]
  const rowBottom = [gridBottom, gridBottom + rowHeights[0] + (present.rows[0] ? VIEW_GUTTER : 0)]

  const placements: ViewPlacement[] = []
  for (const view of drawable) {
    if (!view.bounds) continue
    const cellIndex = cellFor(view)
    const left = columnLeft[cellIndex.column]
    const bottom = rowBottom[cellIndex.row]
    const cell: Bounds2 = {
      min: [left, bottom],
      max: [left + columnWidths[cellIndex.column], bottom + rowHeights[cellIndex.row]],
    }

    // Views are centred on their own column and row extents rather than on
    // their own bounds, which is what keeps front, top and right in projection
    // with one another when they differ in size.
    const columnCentre = left + grid.columns[cellIndex.column].left + columns[cellIndex.column] / 2
    const rowCentre = bottom + grid.rows[cellIndex.row].bottom + rows[cellIndex.row] / 2
    const viewCentre = boundsCenter(view.bounds)
    const viewScale = scaleForView(view.id, scale)

    placements.push({
      id: view.id,
      scale: viewScale,
      offset: [columnCentre - viewCentre[0] * viewScale, rowCentre - viewCentre[1] * viewScale],
      bounds: view.bounds,
      cell,
    })
  }

  return { scale, placements }
}
