import type { DisplayUnits, DocumentParameter, Feature } from '../core/model'
import { formatLengthInput, unitLabel } from '../core/units'
import { annotationExtent, autoDimensionView, centerMarkCurves } from './auto-dimension'
import { boundsSize } from './curve-geometry'
import { renderDimension } from './dimension-render'
import {
  DRAWING_VIEW_LABELS,
  sheetSizeById,
  type Bounds2,
  type DrawingDimension,
  type DrawingOptions,
  type DrawingSheet,
  type DrawingViewId,
  type LineRole,
  type OrthographicViewId,
  type ProjectedCurve,
  type ProjectedView,
  type SheetPrimitive,
} from './drawing-types'
import { hatchRegions } from './hatch'
import { describeModelParameters, filletRadii } from './model-parameters'
import {
  CALLOUT_MARGIN,
  DIMENSION_TEXT_CLEARANCE,
  HATCH_ANGLE,
  HATCH_SPACING,
  PARAMETER_PANEL_WIDTH,
  SECTION_GUTTER,
  SHEET_MARGIN,
  TITLE_BLOCK_HEIGHT,
  VIEW_LABEL_SPACE,
  VIEW_PADDING_BASE,
  formatScale,
} from './sheet-format'
import {
  cuttingPlaneLine,
  notesBlock,
  parameterTable,
  parameterTableHeight,
  sheetFrame,
  titleBlock,
  viewLabel,
} from './sheet-furniture'
import { transformPoint, layoutViews, type ViewPlacement } from './view-layout'

export type BuildSheetInput = {
  views: ProjectedView[]
  features: Feature[]
  displayUnits: DisplayUnits
  /** The document's named parameters, printed at the head of the parameter table. */
  parameters?: DocumentParameter[]
  options: DrawingOptions
  /** Injected so a generated sheet is reproducible in tests. */
  date: Date
}

export type BuiltSheet = {
  sheet: DrawingSheet
  scale: number
  /** Views that carried no geometry, so the caller can say why they are absent. */
  emptyViews: string[]
}

/**
 * How a length is written on the sheet.
 *
 * Bare numbers, with the unit stated once in the title block and notes. Writing
 * "mm" after every dimension is the mark of a drawing made by someone who has
 * not had to read one.
 */
function lengthFormatter(displayUnits: DisplayUnits) {
  return (millimetres: number) => formatLengthInput(millimetres, displayUnits)
}

/** Long form, for the notes where there is room to be unambiguous. */
function unitsDescription(displayUnits: DisplayUnits): string {
  if (displayUnits === 'in-decimal') return 'INCHES (.001)'
  if (displayUnits === 'in-fractional') return 'INCHES (1/16)'
  return 'MILLIMETRES'
}

/** Short form, for the title block cell. */
function unitsAbbreviation(displayUnits: DisplayUnits): string {
  if (displayUnits === 'in-decimal') return 'IN .001'
  if (displayUnits === 'in-fractional') return 'IN 1/16'
  return 'MM'
}

/** Convert one projected curve into sheet space, keeping arcs and circles exact. */
function placeCurve(curve: ProjectedCurve, placement: ViewPlacement, role: LineRole): SheetPrimitive {
  if (curve.type === 'segment') {
    return { kind: 'path', role, points: [transformPoint(placement, curve.start), transformPoint(placement, curve.end)] }
  }
  if (curve.type === 'polyline') {
    return { kind: 'path', role, points: curve.points.map((point) => transformPoint(placement, point)) }
  }
  const center = transformPoint(placement, curve.center)
  const radius = curve.radius * placement.scale
  if (curve.type === 'circle') return { kind: 'circle', role, center, radius }
  return { kind: 'arc', role, center, radius, startAngle: curve.startAngle, endAngle: curve.endAngle }
}

/** What the caption under a view reads, including the section's own letters. */
function viewCaption(view: ProjectedView): string {
  if (view.section) return `SECTION ${view.section.label}-${view.section.label}`
  return DRAWING_VIEW_LABELS[view.id]
}

/**
 * Where the cutting-plane line goes, and which way its arrows point.
 *
 * The line is drawn on the view where the cutting plane appears edge-on — never
 * on the section itself — and the arrows follow the direction of sight of the
 * view the section replaced.
 */
const SECTION_INDICATORS: Record<
  OrthographicViewId,
  { host: OrthographicViewId; horizontal: boolean; sightSign: 1 | -1 }
> = {
  front: { host: 'top', horizontal: true, sightSign: 1 },
  top: { host: 'front', horizontal: true, sightSign: -1 },
  right: { host: 'top', horizontal: false, sightSign: -1 },
}

function buildNotes(features: Feature[], displayUnits: DisplayUnits, extra: string[]): string[] {
  const format = lengthFormatter(displayUnits)
  const notes = [`All dimensions in ${unitsDescription(displayUnits).toLowerCase()} unless noted.`]

  const radii = filletRadii(features)
  if (radii.length === 1) notes.push(`Break all filleted edges R${format(radii[0])}.`)
  else if (radii.length > 1) notes.push(`Fillet radii: ${radii.map((radius) => `R${format(radius)}`).join(', ')}.`)

  notes.push('Dimensions are nominal model geometry. No tolerances specified.')
  return [...notes, ...extra.filter((note) => note.trim().length > 0)]
}

/**
 * Compose a finished sheet from projected views and the model behind them.
 *
 * The sheet is divided before anything is drawn: a strip along the bottom for
 * the title block and notes, an optional column on the right for the parameter
 * table, and whatever is left for the views. Reserving that space up front is
 * what lets the scale be chosen honestly — a view can then never be sized
 * against room that the title block was always going to take.
 */
export function buildDrawingSheet(input: BuildSheetInput): BuiltSheet {
  const { options, features, displayUnits } = input
  const size = sheetSizeById(options.sheetSizeId)
  const format = lengthFormatter(displayUnits)

  const frame = sheetFrame(size.width, size.height, SHEET_MARGIN)
  const primitives: SheetPrimitive[] = [...frame.primitives]

  const bottomStrip: Bounds2 = {
    min: [frame.area.min[0], frame.area.min[1]],
    max: [frame.area.max[0], frame.area.min[1] + TITLE_BLOCK_HEIGHT],
  }

  const parameters = describeModelParameters(features, format, input.parameters)
  const showParameters = options.showParameterTable && parameters.length > 0
  const parameterColumnTop = frame.area.max[1]
  const parameterColumnBottom = bottomStrip.max[1] + SECTION_GUTTER
  const parameterPanel: Bounds2 = {
    min: [
      frame.area.max[0] - PARAMETER_PANEL_WIDTH,
      Math.max(
        parameterColumnBottom,
        parameterColumnTop - parameterTableHeight(parameters.length),
      ),
    ],
    max: [frame.area.max[0], parameterColumnTop],
  }

  const drawingArea: Bounds2 = {
    min: [frame.area.min[0], bottomStrip.max[1] + SECTION_GUTTER],
    max: [
      showParameters ? parameterPanel.min[0] - SECTION_GUTTER : frame.area.max[0],
      frame.area.max[1],
    ],
  }

  const section = options.section.enabled
    ? input.views.find((view) => view.id === 'section' && view.section)
    : undefined

  // A full section stands in for the exterior view it was cut in the direction
  // of, rather than being squeezed in alongside it.
  const replaced = section?.section?.parent
  const selected = options.views
    .filter((id) => id !== replaced)
    .map((id) => input.views.find((view) => view.id === id))
    .filter((view): view is ProjectedView => view !== undefined)
  if (section && options.views.includes(replaced!)) selected.push(section)

  const emptyViews = selected.filter((view) => !view.bounds).map((view) => viewCaption(view))

  // Dimensions are worked out before the layout, because how far they stack is
  // what decides how much room each view needs and therefore what scale the
  // sheet can be drawn at.
  const dimensionsByView = new Map<DrawingViewId, DrawingDimension[]>()
  for (const view of selected) {
    dimensionsByView.set(view.id, options.showDimensions ? autoDimensionView(view, { formatValue: format }) : [])
  }

  const layout = layoutViews(selected, drawingArea, {
    scale: options.scale,
    padding: (id) => {
      const dimensions = dimensionsByView.get(id) ?? []
      const extent = annotationExtent(dimensions)
      // Only a view that actually carries a diameter callout needs room for the
      // leader to lean into. Reserving it everywhere costs a scale step.
      const hasCallout = dimensions.some((dimension) => dimension.kind === 'diameter')
      return {
        left: VIEW_PADDING_BASE.left + extent.left + (extent.left ? DIMENSION_TEXT_CLEARANCE : 0),
        right: VIEW_PADDING_BASE.right + (hasCallout ? CALLOUT_MARGIN : 0),
        top: VIEW_PADDING_BASE.top,
        bottom:
          VIEW_PADDING_BASE.bottom + extent.bottom + (extent.bottom ? DIMENSION_TEXT_CLEARANCE : 0) + VIEW_LABEL_SPACE,
      }
    },
  })
  const scaleLabel = formatScale(layout.scale)

  for (const placement of layout.placements) {
    const view = selected.find((candidate) => candidate.id === placement.id)
    if (!view) continue

    if (options.showHiddenLines) {
      for (const curve of view.hidden) primitives.push(placeCurve(curve, placement, 'hidden'))
    }

    // Hatching is generated in sheet space so its spacing is a fixed distance on
    // paper, the same on a 1:10 sheet as on a 2:1 one.
    if (view.section) {
      const placed = view.section.regions.map((region) => ({
        outer: region.outer.map((point) => transformPoint(placement, point)),
        holes: region.holes.map((hole) => hole.map((point) => transformPoint(placement, point))),
      }))
      for (const [from, to] of hatchRegions(placed, HATCH_SPACING, HATCH_ANGLE)) {
        primitives.push({ kind: 'path', role: 'hatch', points: [from, to] })
      }
    }

    if (options.showCenterMarks) {
      for (const curve of centerMarkCurves(view)) primitives.push(placeCurve(curve, placement, 'center'))
    }
    for (const curve of view.visible) primitives.push(placeCurve(curve, placement, 'visible'))

    for (const dimension of dimensionsByView.get(placement.id) ?? []) {
      primitives.push(...renderDimension(dimension, placement))
    }

    // The caption sits under the cell rather than under the geometry, so
    // captions across a row line up with each other.
    // The caption repeats the view's own scale, which the pictorial view needs
    // because it is deliberately drawn smaller than the rest of the sheet.
    const centreX = (placement.cell.min[0] + placement.cell.max[0]) / 2
    primitives.push(
      ...viewLabel(centreX, placement.cell.min[1] + 1.5, viewCaption(view), formatScale(placement.scale)),
    )
  }

  // The cutting-plane line belongs on whichever view shows the plane edge-on,
  // so it is drawn after every view is placed and only if that host is on the
  // sheet — a section whose reference view is switched off would otherwise be
  // annotated onto empty paper.
  if (section?.section) {
    const indicator = SECTION_INDICATORS[section.section.parent]
    const host = layout.placements.find((placement) => placement.id === indicator.host)
    if (host) {
      const axis = indicator.horizontal ? 1 : 0
      const along = indicator.horizontal ? 0 : 1
      const across = transformPoint(host, indicator.horizontal
        ? [0, section.section.position]
        : [section.section.position, 0])[axis]
      const low = transformPoint(host, host.bounds.min)[along]
      const high = transformPoint(host, host.bounds.max)[along]

      primitives.push(...cuttingPlaneLine({
        horizontal: indicator.horizontal,
        across,
        from: Math.min(low, high),
        to: Math.max(low, high),
        sightSign: indicator.sightSign,
        label: section.section.label,
      }))
    }
  }

  // An empty title-block field should read as "not specified" rather than as an
  // oversight, so it is filled with a dash instead of left blank.
  const stated = (value: string, fallback = '—') => (value.trim() ? value.trim() : fallback)

  const block = titleBlock(frame.area, {
    ...options.title,
    partName: stated(options.title.partName, 'UNTITLED PART'),
    material: stated(options.title.material),
    finish: stated(options.title.finish),
    drawnBy: stated(options.title.drawnBy),
    scaleLabel,
    unitsLabel: unitsAbbreviation(displayUnits),
    date: input.date.toISOString().slice(0, 10),
    sheetLabel: '1 OF 1',
  })
  primitives.push(...block.primitives)

  primitives.push(
    ...notesBlock(
      { min: bottomStrip.min, max: [block.bounds.min[0], bottomStrip.max[1]] },
      buildNotes(features, displayUnits, options.title.notes),
      `GENERATED ${input.date.toISOString().slice(0, 10)} · PARALLAX`,
    ),
  )

  if (showParameters) primitives.push(...parameterTable(parameterPanel, parameters))

  return {
    sheet: {
      width: size.width,
      height: size.height,
      title: `${options.title.partName} — ${scaleLabel} — ${unitLabel(displayUnits)}`,
      primitives,
    },
    scale: layout.scale,
    emptyViews,
  }
}

/** Whether any of the projected views actually carried geometry. */
export function hasDrawableGeometry(views: ProjectedView[]): boolean {
  return views.some((view) => view.bounds !== null && boundsSize(view.bounds).some((extent) => extent > 0))
}
