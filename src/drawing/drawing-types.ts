/**
 * The vocabulary shared by every stage of drawing production.
 *
 * Three coordinate spaces appear here and must not be confused:
 *
 * - **View space** — millimetres on the projection plane, exactly as the kernel
 *   returned them. +X is right and +Y is up in the finished view.
 * - **Sheet space** — millimetres on the paper, origin at the bottom-left
 *   corner, +Y up. Chosen to match PDF so the PDF renderer stays trivial; the
 *   SVG renderer flips once, at the top.
 * - **Model space** — the document's own millimetres. Only the kernel sees it.
 *
 * Sizes that describe the *drawing* rather than the *part* — text height, arrow
 * length, how far a dimension line stands off the geometry — are always sheet
 * millimetres, so they stay legible whatever scale the views are drawn at.
 */

export type Point2 = [number, number]

export type Bounds2 = { min: Point2; max: Point2 }

/** The orthographic views a section can be taken in the direction of. */
export type OrthographicViewId = 'front' | 'top' | 'right'

/** The standard orthographic set, one pictorial view, and one cut view. */
export type DrawingViewId = OrthographicViewId | 'iso' | 'section'

export const DRAWING_VIEW_IDS: DrawingViewId[] = ['front', 'top', 'right', 'iso']

export const ORTHOGRAPHIC_VIEW_IDS: OrthographicViewId[] = ['front', 'top', 'right']

export const DRAWING_VIEW_LABELS: Record<DrawingViewId, string> = {
  front: 'FRONT',
  top: 'TOP',
  right: 'RIGHT',
  iso: 'ISOMETRIC',
  section: 'SECTION',
}

/**
 * One projected curve in view space.
 *
 * Lines, circles and arcs survive as themselves so the output stays exact and
 * annotatable — a circle is what makes a hole callout possible. Everything else
 * (splines, ellipses, fillet seams) arrives pre-sampled, because a drawing only
 * ever needs those to look right, never to be measured.
 */
export type ProjectedCurve =
  | { type: 'segment'; start: Point2; end: Point2 }
  | { type: 'circle'; center: Point2; radius: number }
  | { type: 'arc'; center: Point2; radius: number; startAngle: number; endAngle: number }
  | { type: 'polyline'; points: Point2[] }

/**
 * One face of solid material met by the cutting plane, in view coordinates.
 *
 * Outer boundary and holes are kept apart rather than flattened, because the
 * hatching that marks this as material has to stop at a bore and start again
 * on the far side.
 */
export type SectionRegion = { outer: Point2[]; holes: Point2[][] }

export type ProjectedView = {
  id: DrawingViewId
  /** Curves the viewer can see, drawn as continuous lines. */
  visible: ProjectedCurve[]
  /** Curves behind material, drawn dashed. Already de-duplicated against `visible`. */
  hidden: ProjectedCurve[]
  bounds: Bounds2 | null
  /** Present only on a section view: where the cut was taken and what it met. */
  section?: {
    /** The orthographic view this section is drawn in place of. */
    parent: OrthographicViewId
    /** Letter pair identifying the cut, as in "SECTION A-A". */
    label: string
    /** Where the cutting plane sits along the view direction, in model millimetres. */
    position: number
    /** Solid material met by the cut, to be hatched. */
    regions: SectionRegion[]
  }
}

/** How a stroke or piece of text is meant to read, rather than how it is drawn. */
export type LineRole =
  | 'visible'
  | 'hidden'
  | 'center'
  | 'dimension'
  | 'annotation'
  | 'border'
  | 'titleRule'
  /** Section hatching: thin, so it reads as fill rather than as edges. */
  | 'hatch'
  /** The heavy chain line marking where a section was cut. */
  | 'cuttingPlane'

export type TextAnchor = 'start' | 'middle' | 'end'
export type TextBaseline = 'bottom' | 'middle' | 'top'

export type SheetPrimitive =
  | { kind: 'path'; role: LineRole; points: Point2[]; closed?: boolean }
  | { kind: 'circle'; role: LineRole; center: Point2; radius: number }
  | { kind: 'arc'; role: LineRole; center: Point2; radius: number; startAngle: number; endAngle: number }
  /** A filled polygon. Only arrowheads and the projection symbol need one. */
  | { kind: 'fill'; role: LineRole; points: Point2[] }
  | {
      kind: 'text'
      role: LineRole
      at: Point2
      text: string
      /** Cap height in sheet millimetres. */
      size: number
      anchor: TextAnchor
      baseline: TextBaseline
      bold?: boolean
      /** Counter-clockwise degrees, for dimensions that read up the page. */
      rotation?: number
    }

/** A finished sheet: paper size plus everything printed on it. */
export type DrawingSheet = {
  /** Sheet width in millimetres. */
  width: number
  /** Sheet height in millimetres. */
  height: number
  /** Used for the PDF document title and the suggested file name. */
  title: string
  primitives: SheetPrimitive[]
}

/**
 * A dimension before it becomes ink.
 *
 * Anchors are in view space so they can be derived from geometry, while
 * `offset` and `leader` are sheet millimetres so the annotation keeps its
 * proportions at any drawing scale.
 */
export type DrawingDimension =
  | {
      kind: 'linear'
      axis: 'horizontal' | 'vertical'
      from: Point2
      to: Point2
      /** Sheet millimetres from the measured points out to the dimension line. */
      offset: number
      text: string
    }
  | {
      kind: 'diameter'
      center: Point2
      radius: number
      /** Direction of the leader out of the circle, in radians. */
      angle: number
      /** Sheet millimetres from the circle to the text. */
      leader: number
      text: string
    }
  /**
   * A radius callout on an arc — how a fillet or a rounded corner is stated.
   *
   * Distinct from `diameter` because the convention differs: a radius is
   * measured from the centre to the curve and written "R3", while a full circle
   * is measured across and written "Ø6". Writing a fillet as a diameter would
   * be read as a hole.
   */
  | {
      kind: 'radius'
      center: Point2
      radius: number
      /** Direction from the centre out through the arc, in radians. */
      angle: number
      /** Sheet millimetres from the arc to the text. */
      leader: number
      text: string
    }

export type SheetSize = {
  id: string
  label: string
  width: number
  height: number
}

/** Landscape paper, since orthographic sets are wider than they are tall. */
export const SHEET_SIZES: SheetSize[] = [
  { id: 'letter', label: 'Letter · 11 × 8.5 in', width: 279.4, height: 215.9 },
  { id: 'tabloid', label: 'Tabloid · 17 × 11 in', width: 431.8, height: 279.4 },
  { id: 'a4', label: 'A4 · 297 × 210 mm', width: 297, height: 210 },
  { id: 'a3', label: 'A3 · 420 × 297 mm', width: 420, height: 297 },
]

export function sheetSizeById(id: string): SheetSize {
  return SHEET_SIZES.find((size) => size.id === id) ?? SHEET_SIZES[0]
}

export type TitleBlockInfo = {
  partName: string
  drawnBy: string
  material: string
  finish: string
  notes: string[]
}

/**
 * A requested cut.
 *
 * `position` is a fraction of the part's extent along the view direction rather
 * than an absolute coordinate, so the default of 0.5 cuts through the middle of
 * any part without the caller needing to know its size.
 */
export type SectionOptions = {
  enabled: boolean
  /** Which orthographic view the section is drawn in the direction of. */
  parent: OrthographicViewId
  /** Where to cut, as a fraction from 0 to 1 across the part. */
  position: number
}

export type DrawingOptions = {
  sheetSizeId: string
  views: DrawingViewId[]
  showHiddenLines: boolean
  showDimensions: boolean
  showCenterMarks: boolean
  showParameterTable: boolean
  section: SectionOptions
  /** null asks the layout to pick the largest standard scale that fits. */
  scale: number | null
  title: TitleBlockInfo
}
