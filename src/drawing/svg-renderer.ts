import { TAU } from './curve-geometry'
import type { DrawingSheet, Point2, SheetPrimitive } from './drawing-types'
import { fontSizeForCapHeight } from './helvetica-metrics'
import { STROKE_STYLES } from './sheet-format'

/**
 * Render a sheet to SVG.
 *
 * The SVG is both the in-app preview and a second export format, so it must
 * agree with the PDF exactly. It does that by sharing the same primitives, the
 * same stroke table and the same font metrics — the only thing that differs is
 * that SVG's Y axis points down, which is handled once, in `flip`.
 */

function n(value: number): string {
  return (Math.round(value * 1000) / 1000).toString()
}

function greyToHex(grey: number): string {
  const channel = Math.round(Math.max(0, Math.min(1, grey)) * 255)
  return `#${channel.toString(16).padStart(2, '0').repeat(3)}`
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function strokeAttributes(role: SheetPrimitive['role']): string {
  const style = STROKE_STYLES[role]
  const dash = style.dash.length ? ` stroke-dasharray="${style.dash.map(n).join(' ')}"` : ''
  return `fill="none" stroke="${greyToHex(style.grey)}" stroke-width="${n(style.width)}"${dash}`
}

function renderPrimitive(primitive: SheetPrimitive, height: number): string {
  const flip = (point: Point2): Point2 => [point[0], height - point[1]]

  if (primitive.kind === 'text') {
    const [x, y] = flip(primitive.at)
    const anchor = primitive.anchor === 'middle' ? 'middle' : primitive.anchor === 'end' ? 'end' : 'start'
    const dy =
      primitive.baseline === 'middle' ? primitive.size / 2 : primitive.baseline === 'top' ? primitive.size : 0
    // Sheet rotation is counter-clockwise; on a flipped Y axis that is a
    // negative SVG rotation about the same anchor point.
    const rotation = primitive.rotation ? ` transform="rotate(${n(-primitive.rotation)} ${n(x)} ${n(y - dy)})"` : ''
    return (
      `<text x="${n(x)}" y="${n(y - dy)}" font-family="Helvetica, Arial, sans-serif" ` +
      `font-size="${n(fontSizeForCapHeight(primitive.size))}" ` +
      `${primitive.bold ? 'font-weight="bold" ' : ''}text-anchor="${anchor}" ` +
      `fill="${greyToHex(STROKE_STYLES[primitive.role].grey)}"${rotation}>${escapeXml(primitive.text)}</text>`
    )
  }

  if (primitive.kind === 'fill') {
    const points = primitive.points.map(flip).map((point) => `${n(point[0])},${n(point[1])}`).join(' ')
    return `<polygon points="${points}" fill="${greyToHex(STROKE_STYLES[primitive.role].grey)}" />`
  }

  if (primitive.kind === 'path') {
    if (primitive.points.length < 2) return ''
    const [first, ...rest] = primitive.points.map(flip)
    const commands = [`M ${n(first[0])} ${n(first[1])}`, ...rest.map((point) => `L ${n(point[0])} ${n(point[1])}`)]
    if (primitive.closed) commands.push('Z')
    return `<path d="${commands.join(' ')}" ${strokeAttributes(primitive.role)} />`
  }

  if (primitive.kind === 'circle') {
    const [x, y] = flip(primitive.center)
    return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(primitive.radius)}" ${strokeAttributes(primitive.role)} />`
  }

  const start = flip([
    primitive.center[0] + primitive.radius * Math.cos(primitive.startAngle),
    primitive.center[1] + primitive.radius * Math.sin(primitive.startAngle),
  ])
  const end = flip([
    primitive.center[0] + primitive.radius * Math.cos(primitive.endAngle),
    primitive.center[1] + primitive.radius * Math.sin(primitive.endAngle),
  ])
  const sweep = primitive.endAngle - primitive.startAngle
  const largeArc = Math.abs(sweep) % TAU > Math.PI ? 1 : 0
  // Arcs are stored counter-clockwise, which reads as clockwise once Y is
  // flipped — SVG's positive sweep direction.
  const d =
    `M ${n(start[0])} ${n(start[1])} A ${n(primitive.radius)} ${n(primitive.radius)} 0 ${largeArc} 1 ` +
    `${n(end[0])} ${n(end[1])}`
  return `<path d="${d}" ${strokeAttributes(primitive.role)} />`
}

export function renderSheetToSvg(sheet: DrawingSheet): string {
  const body = sheet.primitives
    .map((primitive) => renderPrimitive(primitive, sheet.height))
    .filter((markup) => markup.length > 0)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(sheet.width)}mm" height="${n(sheet.height)}mm" ` +
      `viewBox="0 0 ${n(sheet.width)} ${n(sheet.height)}" role="img" aria-label="${escapeXml(sheet.title)}">`,
    `<title>${escapeXml(sheet.title)}</title>`,
    `<rect x="0" y="0" width="${n(sheet.width)}" height="${n(sheet.height)}" fill="#ffffff" />`,
    ...body,
    '</svg>',
  ].join('\n')
}
