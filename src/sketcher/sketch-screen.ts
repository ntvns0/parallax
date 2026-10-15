import { arcEndPoint, arcPointAt, arcStartPoint, type ArcLike } from '../core/arc-geometry'
import type { Vec2 } from '../core/model'
import { modelToScreen, type SketchView, type ViewportSize } from './sketch-view'

/** Model millimetres to sketch-surface pixels, for one view. */
export type ScreenMap = {
  toX: (value: number) => number
  toY: (value: number) => number
  scale: number
}

export function screenMap(view: SketchView, size: ViewportSize): ScreenMap {
  return {
    toX: (value) => modelToScreen(view, size, [value, 0])[0],
    toY: (value) => modelToScreen(view, size, [0, value])[1],
    scale: view.scale,
  }
}

/**
 * An arc as an SVG path.
 *
 * The sweep flag is always 1 because arcs are stored sweeping
 * counter-clockwise and the screen's Y axis points down, which turns that
 * into a clockwise sweep here — the same reasoning the sheet renderer uses.
 */
export function arcPath(arc: ArcLike, { toX, toY, scale }: ScreenMap) {
  const radius = arc.radius * scale
  const sweep = arc.endAngle - arc.startAngle
  const from = arcStartPoint(arc)
  const arcTo = (target: Vec2, large: 0 | 1) =>
    `A ${radius} ${radius} 0 ${large} 1 ${toX(target[0])} ${toY(target[1])}`
  // A full turn starts and ends at the same point, which a single arc command
  // cannot describe, so it goes round in two halves.
  if (sweep >= Math.PI * 2 - 1e-9) {
    return `M ${toX(from[0])} ${toY(from[1])} ${arcTo(arcPointAt(arc, 0.5), 0)} ${arcTo(from, 0)}`
  }
  return `M ${toX(from[0])} ${toY(from[1])} ${arcTo(arcEndPoint(arc), sweep > Math.PI ? 1 : 0)}`
}
