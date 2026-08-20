import type { LineRole } from './drawing-types'

/**
 * Drafting conventions, in one place.
 *
 * The numbers follow ISO 128 line groups and the usual 2.5–5 mm lettering
 * range. They are all sheet millimetres, so a 1:10 view and a 5:1 view are
 * annotated identically — which is the point of a scaled drawing.
 */

export type StrokeStyle = {
  /** Stroke width in sheet millimetres. */
  width: number
  /** Dash pattern in sheet millimetres, empty for a continuous line. */
  dash: number[]
  /** Greyscale ink, 0 black to 1 white. Drawings print black; grey is for rules. */
  grey: number
}

export const STROKE_STYLES: Record<LineRole, StrokeStyle> = {
  visible: { width: 0.5, dash: [], grey: 0 },
  hidden: { width: 0.3, dash: [2.4, 1.2], grey: 0.25 },
  center: { width: 0.25, dash: [6, 1.2, 1, 1.2], grey: 0.3 },
  dimension: { width: 0.25, dash: [], grey: 0 },
  annotation: { width: 0.25, dash: [], grey: 0 },
  border: { width: 0.7, dash: [], grey: 0 },
  titleRule: { width: 0.25, dash: [], grey: 0.35 },
  hatch: { width: 0.18, dash: [], grey: 0.35 },
  cuttingPlane: { width: 0.7, dash: [8, 1.5, 2, 1.5], grey: 0 },
}

/** Spacing between section hatch lines, in sheet millimetres. */
export const HATCH_SPACING = 2.2
export const HATCH_ANGLE = Math.PI / 4

export const TEXT_SIZES = {
  dimension: 3,
  viewLabel: 3.5,
  sheetTitle: 5,
  fieldLabel: 2.2,
  fieldValue: 3,
  note: 2.6,
  tableRow: 2.5,
} as const

export const ARROW_LENGTH = 3.2
export const ARROW_HALF_WIDTH = 0.9

/** How far a witness line stops short of the feature it points at. */
export const EXTENSION_GAP = 1.2
/** How far a witness line runs past the dimension line. */
export const EXTENSION_OVERSHOOT = 1.6
/** Distance from the geometry out to the first dimension line. */
export const FIRST_DIMENSION_OFFSET = 10
/** Added for each further dimension stacked beyond the first. */
export const DIMENSION_STEP = 7

export const SHEET_MARGIN = 10
export const TITLE_BLOCK_WIDTH = 112
export const TITLE_BLOCK_HEIGHT = 34
export const PARAMETER_PANEL_WIDTH = 64
export const SECTION_GUTTER = 6
/** Space between the two columns and two rows of the view grid. */
export const VIEW_GUTTER = 16

/**
 * Base clearance around a view, in sheet millimetres.
 *
 * Whatever the dimensions themselves need is measured and added to this — see
 * `annotationExtent`. Reserving a fixed margin instead would either waste paper
 * on a plain view or let a deeply stacked dimension run into the view below it.
 */
export const VIEW_PADDING_BASE = { left: 6, right: 8, bottom: 6, top: 6 }
/** Extra clearance on the side diameter callouts lean into. */
export const CALLOUT_MARGIN = 18
/** Clearance between the last dimension line and the text sitting on it. */
export const DIMENSION_TEXT_CLEARANCE = 5
/** Height of the caption block printed under every view. */
export const VIEW_LABEL_SPACE = 12

/**
 * Preferred drawing scales, largest first.
 *
 * Restricting to this list is what makes a printed sheet measurable: a reader
 * with a scale rule can check a dimension against 1:2, but not against 1:2.37.
 *
 * The list follows ISO 5455, including the 1:2.5 and 1:4 steps it permits. They
 * matter more than they look: without them the ladder jumps straight from 1:2
 * to 1:5, and a part that misses 1:2 by a millimetre gets drawn at less than
 * half the size the paper could have carried.
 */
export const STANDARD_SCALES = [
  50, 20, 10, 8, 5, 4, 2, 1,
  1 / 2, 1 / 2.5, 1 / 4, 1 / 5, 1 / 8, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200,
]

export function formatScale(scale: number): string {
  if (Math.abs(scale - 1) < 1e-9) return '1:1'
  if (scale > 1) {
    const rounded = Math.round(scale * 100) / 100
    return `${rounded}:1`
  }
  const inverse = Math.round((1 / scale) * 100) / 100
  return `1:${inverse}`
}
