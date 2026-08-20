import type { Bounds2, Point2, SheetPrimitive, TextAnchor, TitleBlockInfo } from './drawing-types'
import { fitCapHeight } from './helvetica-metrics'
import { TEXT_SIZES, TITLE_BLOCK_HEIGHT, TITLE_BLOCK_WIDTH } from './sheet-format'

/**
 * Everything printed on a sheet that is not the part: frame, title block,
 * notes, and the model parameter table.
 *
 * "Furniture" is the printer's word for it, and the separation is useful — none
 * of it depends on geometry, so it can be laid out and tested on its own.
 */

const PADDING = 2

function rect(bounds: Bounds2, role: SheetPrimitive['role']): SheetPrimitive {
  return {
    kind: 'path',
    role,
    closed: true,
    points: [
      [bounds.min[0], bounds.min[1]],
      [bounds.max[0], bounds.min[1]],
      [bounds.max[0], bounds.max[1]],
      [bounds.min[0], bounds.max[1]],
    ],
  }
}

function line(from: Point2, to: Point2, role: SheetPrimitive['role']): SheetPrimitive {
  return { kind: 'path', role, points: [from, to] }
}

function text(
  at: Point2,
  value: string,
  size: number,
  options: { anchor?: TextAnchor; bold?: boolean; role?: SheetPrimitive['role'] } = {},
): SheetPrimitive {
  return {
    kind: 'text',
    role: options.role ?? 'annotation',
    at,
    text: value,
    size,
    anchor: options.anchor ?? 'start',
    baseline: 'bottom',
    bold: options.bold,
  }
}

/**
 * A labelled box in the title block: small caption above, value beneath it.
 *
 * The value is shrunk to fit its cell. These fields hold free text — a part
 * name, an alloy designation — and one long entry must not print across the
 * neighbouring field and make both unreadable.
 */
function field(bounds: Bounds2, label: string, value: string, valueSize: number = TEXT_SIZES.fieldValue): SheetPrimitive[] {
  const available = bounds.max[0] - bounds.min[0] - PADDING * 2
  return [
    text([bounds.min[0] + PADDING, bounds.max[1] - PADDING - TEXT_SIZES.fieldLabel], label, TEXT_SIZES.fieldLabel, {
      role: 'titleRule',
    }),
    text([bounds.min[0] + PADDING, bounds.min[1] + PADDING + 0.6], value, fitCapHeight(value, available, valueSize), {
      bold: true,
    }),
  ]
}

/**
 * The third-angle projection symbol: a truncated cone beside its end view.
 *
 * Which side the circles sit on *is* the symbol — putting them on the right
 * would declare a first-angle drawing and invert how every view relates to the
 * front one. They belong on the left, because in third angle a view is drawn on
 * the same side as the eye that saw it.
 */
export function projectionSymbol(centre: Point2, height: number): SheetPrimitive[] {
  const largeRadius = height / 2
  const smallRadius = height / 4
  const circleCentre: Point2 = [centre[0] - height * 0.62, centre[1]]
  const coneLeft = centre[0] - height * 0.1
  const coneRight = centre[0] + height * 0.95

  return [
    { kind: 'circle', role: 'annotation', center: circleCentre, radius: largeRadius },
    { kind: 'circle', role: 'annotation', center: circleCentre, radius: smallRadius },
    line([coneLeft, centre[1] - smallRadius], [coneLeft, centre[1] + smallRadius], 'annotation'),
    line([coneRight, centre[1] - largeRadius], [coneRight, centre[1] + largeRadius], 'annotation'),
    line([coneLeft, centre[1] + smallRadius], [coneRight, centre[1] + largeRadius], 'annotation'),
    line([coneLeft, centre[1] - smallRadius], [coneRight, centre[1] - largeRadius], 'annotation'),
    line([circleCentre[0] - largeRadius * 1.3, centre[1]], [coneRight + 1.5, centre[1]], 'center'),
  ]
}

export function sheetFrame(width: number, height: number, margin: number): { primitives: SheetPrimitive[]; area: Bounds2 } {
  const area: Bounds2 = { min: [margin, margin], max: [width - margin, height - margin] }
  return { primitives: [rect(area, 'border')], area }
}

export type TitleBlockFields = TitleBlockInfo & {
  scaleLabel: string
  unitsLabel: string
  date: string
  sheetLabel: string
}

/**
 * The title block, anchored to the bottom-right corner of the frame.
 *
 * Bottom-right is where a reader looks for it on a folded print, and it is the
 * one part of the sheet whose position is genuinely standardised.
 */
export function titleBlock(area: Bounds2, fields: TitleBlockFields): { primitives: SheetPrimitive[]; bounds: Bounds2 } {
  const bounds: Bounds2 = {
    min: [area.max[0] - TITLE_BLOCK_WIDTH, area.min[1]],
    max: [area.max[0], area.min[1] + TITLE_BLOCK_HEIGHT],
  }
  const [left, bottom] = bounds.min
  const [right, top] = bounds.max

  const nameRowBottom = top - 14
  const detailRowBottom = nameRowBottom - 10

  const primitives: SheetPrimitive[] = [
    rect(bounds, 'border'),
    line([left, nameRowBottom], [right, nameRowBottom], 'titleRule'),
    line([left, detailRowBottom], [right, detailRowBottom], 'titleRule'),
  ]

  primitives.push(
    ...field({ min: [left, nameRowBottom], max: [right, top] }, 'PART', fields.partName, TEXT_SIZES.sheetTitle),
  )

  const detailSplit = left + 62
  primitives.push(line([detailSplit, detailRowBottom], [detailSplit, nameRowBottom], 'titleRule'))
  primitives.push(...field({ min: [left, detailRowBottom], max: [detailSplit, nameRowBottom] }, 'MATERIAL', fields.material))
  primitives.push(...field({ min: [detailSplit, detailRowBottom], max: [right, nameRowBottom] }, 'FINISH', fields.finish))

  const columns = [left, left + 24, left + 50, left + 84, right]
  const cells: [string, string][] = [
    ['SCALE', fields.scaleLabel],
    ['UNITS', fields.unitsLabel],
    ['DRAWN BY', fields.drawnBy],
    ['SHEET', fields.sheetLabel],
  ]
  cells.forEach(([label, value], index) => {
    if (index > 0) primitives.push(line([columns[index], bottom], [columns[index], detailRowBottom], 'titleRule'))
    primitives.push(...field({ min: [columns[index], bottom], max: [columns[index + 1], detailRowBottom] }, label, value))
  })

  return { primitives, bounds }
}

/**
 * General notes, plus the projection symbol and the date, filling the bottom
 * strip to the left of the title block.
 */
export function notesBlock(bounds: Bounds2, notes: string[], date: string): SheetPrimitive[] {
  const primitives: SheetPrimitive[] = [rect(bounds, 'border')]
  const symbolHeight = 7
  const symbolCentre: Point2 = [bounds.max[0] - 16, bounds.min[1] + TITLE_BLOCK_HEIGHT / 2 + 1]

  primitives.push(...projectionSymbol(symbolCentre, symbolHeight))
  primitives.push(
    text([symbolCentre[0], bounds.min[1] + 2], 'THIRD ANGLE', TEXT_SIZES.fieldLabel, {
      anchor: 'middle',
      role: 'titleRule',
    }),
  )
  primitives.push(
    text([bounds.min[0] + PADDING, bounds.max[1] - PADDING - TEXT_SIZES.fieldLabel], 'NOTES', TEXT_SIZES.fieldLabel, {
      role: 'titleRule',
    }),
  )

  const lineHeight = TEXT_SIZES.note * 1.75
  notes.slice(0, 4).forEach((note, index) => {
    primitives.push(
      text(
        [bounds.min[0] + PADDING, bounds.max[1] - 9 - lineHeight * index],
        `${index + 1}. ${note}`,
        TEXT_SIZES.note,
      ),
    )
  })

  primitives.push(text([bounds.min[0] + PADDING, bounds.min[1] + 1.6], date, TEXT_SIZES.fieldLabel, { role: 'titleRule' }))
  return primitives
}

export type ParameterRow = { label: string; value: string }

const PARAMETER_HEADER_HEIGHT = 7
const PARAMETER_ROW_HEIGHT = TEXT_SIZES.tableRow * 2

/**
 * How tall the parameter table wants to be for a given number of rows.
 *
 * The box is sized to its contents rather than stretched to fill the column: a
 * mostly empty rule down the side of a sheet reads as something missing.
 */
export function parameterTableHeight(rowCount: number): number {
  return PARAMETER_HEADER_HEIGHT + PARAMETER_ROW_HEIGHT * rowCount + 3
}

/**
 * The model parameter table.
 *
 * These are the numbers the parametric model is actually driven by. A
 * dimensioned view says what the part measures; this says which of those
 * measurements someone can change and have the model rebuild — which is
 * exactly the question a customer asks after seeing the first draft.
 */
export function parameterTable(bounds: Bounds2, rows: ParameterRow[]): SheetPrimitive[] {
  const primitives: SheetPrimitive[] = [rect(bounds, 'border')]
  const headerBottom = bounds.max[1] - PARAMETER_HEADER_HEIGHT

  primitives.push(line([bounds.min[0], headerBottom], [bounds.max[0], headerBottom], 'titleRule'))
  primitives.push(
    text([bounds.min[0] + PADDING, headerBottom + 2.2], 'MODEL PARAMETERS', TEXT_SIZES.fieldLabel, { bold: true }),
  )

  const rowHeight = PARAMETER_ROW_HEIGHT
  const capacity = Math.max(0, Math.floor((headerBottom - bounds.min[1] - 2) / rowHeight))
  const shown = rows.slice(0, capacity)

  shown.forEach((row, index) => {
    const baseline = headerBottom - rowHeight * (index + 1) + rowHeight * 0.35
    primitives.push(text([bounds.min[0] + PADDING, baseline], row.label, TEXT_SIZES.tableRow))
    primitives.push(
      text([bounds.max[0] - PADDING, baseline], row.value, TEXT_SIZES.tableRow, { anchor: 'end', bold: true }),
    )
  })

  if (rows.length > shown.length) {
    primitives.push(
      text(
        [bounds.min[0] + PADDING, bounds.min[1] + 2],
        `+${rows.length - shown.length} more`,
        TEXT_SIZES.fieldLabel,
        { role: 'titleRule' },
      ),
    )
  }

  return primitives
}

/**
 * The cutting-plane line, drawn across the view where the cut appears edge-on.
 *
 * The arrows point the way the reader is meant to look, which is the whole
 * content of the symbol: they say which half of the part was taken away and
 * therefore which face the section shows. Reversing them would describe a
 * different section entirely.
 *
 * `across` is the sheet coordinate the plane sits at, `from` and `to` bracket
 * the view along the plane, and `sightSign` is +1 or -1 for the direction of
 * sight in the axis the arrows point along.
 */
export function cuttingPlaneLine(options: {
  horizontal: boolean
  across: number
  from: number
  to: number
  sightSign: 1 | -1
  label: string
}): SheetPrimitive[] {
  const { horizontal, across, from, to, sightSign, label } = options
  const at = (along: number, offset: number): Point2 => (horizontal ? [along, offset] : [offset, along])
  const overhang = 6
  const arrowLength = 7

  const start = from - overhang
  const end = to + overhang

  const primitives: SheetPrimitive[] = [
    { kind: 'path', role: 'cuttingPlane', points: [at(start, across), at(end, across)] },
  ]

  for (const along of [start, end]) {
    const tip: Point2 = at(along, across + sightSign * arrowLength)
    const direction: Point2 = horizontal ? [0, sightSign] : [sightSign, 0]
    const length = arrowLength * 0.45
    const perpendicular: Point2 = [-direction[1], direction[0]]

    primitives.push({ kind: 'path', role: 'cuttingPlane', points: [at(along, across), tip] })
    primitives.push({
      kind: 'fill',
      role: 'cuttingPlane',
      points: [
        tip,
        [tip[0] - direction[0] * length + perpendicular[0] * length * 0.35, tip[1] - direction[1] * length + perpendicular[1] * length * 0.35],
        [tip[0] - direction[0] * length - perpendicular[0] * length * 0.35, tip[1] - direction[1] * length - perpendicular[1] * length * 0.35],
      ],
    })
    primitives.push(
      text(
        at(along, across + sightSign * (arrowLength + 4)),
        label,
        TEXT_SIZES.viewLabel,
        { anchor: 'middle', bold: true },
      ),
    )
  }

  return primitives
}

/** The caption under a view, naming it and repeating the scale. */
export function viewLabel(centreX: number, baselineY: number, label: string, scaleLabel: string): SheetPrimitive[] {
  return [
    text([centreX, baselineY], label, TEXT_SIZES.viewLabel, { anchor: 'middle', bold: true }),
    text([centreX, baselineY - TEXT_SIZES.viewLabel - 1.4], scaleLabel, TEXT_SIZES.fieldLabel, {
      anchor: 'middle',
      role: 'titleRule',
    }),
  ]
}
