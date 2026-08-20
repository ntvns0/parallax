import { TAU } from './curve-geometry'
import type { DrawingSheet, Point2, SheetPrimitive } from './drawing-types'
import { fontSizeForCapHeight, textWidth } from './helvetica-metrics'
import { createPdfDocument, escapePdfText } from './pdf-document'
import { STROKE_STYLES } from './sheet-format'

/** Enough precision for a 0.01 mm feature on a metre-wide sheet, and no more. */
function n(value: number): string {
  return (Math.round(value * 1000) / 1000).toString()
}

/**
 * Cubic control-point offset for a circular arc of `sweep` radians.
 *
 * PDF has no arc operator, so every curve is a Bézier. This is the standard
 * magic constant generalised: for a quarter turn it gives the familiar 0.5523.
 */
function bezierHandle(sweep: number): number {
  return (4 / 3) * Math.tan(sweep / 4)
}

/**
 * Approximate an arc with Béziers, splitting so no segment exceeds 90°.
 *
 * Beyond a quarter turn the single-segment error grows fast enough to be
 * visible on a printed circle, and a hole that prints out-of-round undermines
 * the whole document.
 */
function arcOperators(center: Point2, radius: number, startAngle: number, endAngle: number, startNewPath: boolean): string[] {
  const total = endAngle - startAngle
  const segments = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)))
  const step = total / segments
  const handle = bezierHandle(step) * radius

  const operators: string[] = []
  const at = (angle: number): Point2 => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
  const tangent = (angle: number): Point2 => [-Math.sin(angle), Math.cos(angle)]

  const first = at(startAngle)
  if (startNewPath) operators.push(`${n(first[0])} ${n(first[1])} m`)

  for (let index = 0; index < segments; index += 1) {
    const from = startAngle + step * index
    const to = from + step
    const p0 = at(from)
    const p1 = at(to)
    const t0 = tangent(from)
    const t1 = tangent(to)
    operators.push(
      `${n(p0[0] + t0[0] * handle)} ${n(p0[1] + t0[1] * handle)} ` +
        `${n(p1[0] - t1[0] * handle)} ${n(p1[1] - t1[1] * handle)} ` +
        `${n(p1[0])} ${n(p1[1])} c`,
    )
  }
  return operators
}

function strokeSetup(role: SheetPrimitive['role']): string {
  const style = STROKE_STYLES[role]
  const dash = style.dash.length ? `[${style.dash.map(n).join(' ')}] 0 d` : '[] 0 d'
  return `${n(style.width)} w ${dash} ${n(style.grey)} G`
}

function renderPrimitive(primitive: SheetPrimitive): string[] {
  if (primitive.kind === 'text') {
    const fontSize = fontSizeForCapHeight(primitive.size)
    const width = textWidth(primitive.text, primitive.size, primitive.bold)
    const shift = primitive.anchor === 'middle' ? -width / 2 : primitive.anchor === 'end' ? -width : 0
    const rise =
      primitive.baseline === 'middle' ? -primitive.size / 2 : primitive.baseline === 'top' ? -primitive.size : 0

    // The text matrix carries both the rotation and the anchor shift, so the
    // shift stays in the text's own frame — a rotated dimension still centres
    // along its own reading direction rather than along the page.
    const radians = ((primitive.rotation ?? 0) * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const x = primitive.at[0] + shift * cos - rise * sin
    const y = primitive.at[1] + shift * sin + rise * cos

    return [
      'BT',
      `${primitive.bold ? '/F2' : '/F1'} ${n(fontSize)} Tf`,
      `${n(STROKE_STYLES[primitive.role].grey)} g`,
      `${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x)} ${n(y)} Tm`,
      `(${escapePdfText(primitive.text)}) Tj`,
      'ET',
    ]
  }

  if (primitive.kind === 'fill') {
    const [first, ...rest] = primitive.points
    return [
      `${n(STROKE_STYLES[primitive.role].grey)} g`,
      `${n(first[0])} ${n(first[1])} m`,
      ...rest.map((point) => `${n(point[0])} ${n(point[1])} l`),
      'h f',
    ]
  }

  const setup = strokeSetup(primitive.role)

  if (primitive.kind === 'path') {
    if (primitive.points.length < 2) return []
    const [first, ...rest] = primitive.points
    return [
      setup,
      `${n(first[0])} ${n(first[1])} m`,
      ...rest.map((point) => `${n(point[0])} ${n(point[1])} l`),
      primitive.closed ? 'h S' : 'S',
    ]
  }

  if (primitive.kind === 'circle') {
    return [setup, ...arcOperators(primitive.center, primitive.radius, 0, TAU, true), 'h S']
  }

  return [
    setup,
    ...arcOperators(primitive.center, primitive.radius, primitive.startAngle, primitive.endAngle, true),
    'S',
  ]
}

/**
 * Render a sheet to PDF bytes.
 *
 * Sheet space and PDF user space share an origin and a direction, so no flip is
 * needed here — that was the reason for choosing a bottom-left origin for the
 * sheet in the first place.
 */
export function renderSheetToPdf(sheet: DrawingSheet, date = new Date()): Uint8Array {
  const operators = ['1 j 1 J', ...sheet.primitives.flatMap(renderPrimitive)]
  return createPdfDocument({
    widthMm: sheet.width,
    heightMm: sheet.height,
    title: sheet.title,
    content: operators.join('\n'),
    date,
  })
}
