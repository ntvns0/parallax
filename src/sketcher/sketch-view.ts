import type { Vec2 } from '../core/model'

/**
 * The sketcher's pan/zoom transform.
 *
 * Model space is millimeters with +Y up; screen space is SVG pixels with +Y
 * down, origin at the top-left. Everything the sketcher draws and every pointer
 * position it reads goes through the pair below, so the two directions cannot
 * drift apart.
 */
export type SketchView = {
  scale: number
  panX: number
  panY: number
}

export type ViewportSize = {
  width: number
  height: number
}

export const MIN_SCALE = 0.45
export const MAX_SCALE = 48
export const INITIAL_SCALE = 4

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function modelToScreen(view: SketchView, size: ViewportSize, point: Vec2): Vec2 {
  return [
    size.width / 2 + view.panX + point[0] * view.scale,
    size.height / 2 + view.panY - point[1] * view.scale,
  ]
}

/** `offset` is a position relative to the sketch surface's top-left corner. */
export function screenToModel(view: SketchView, size: ViewportSize, offset: Vec2): Vec2 {
  return [
    (offset[0] - size.width / 2 - view.panX) / view.scale,
    -(offset[1] - size.height / 2 - view.panY) / view.scale,
  ]
}

/**
 * Zoom about a screen position, keeping whatever model point sits under it
 * exactly where it is. This is what makes wheel zoom follow the cursor rather
 * than drifting toward the middle of the canvas.
 */
export function zoomAtScreenPoint(view: SketchView, size: ViewportSize, offset: Vec2, factor: number): SketchView {
  const scale = clampScale(view.scale * factor)
  const anchor = screenToModel(view, size, offset)
  return {
    scale,
    panX: offset[0] - size.width / 2 - anchor[0] * scale,
    panY: offset[1] - size.height / 2 + anchor[1] * scale,
  }
}

/** Zoom about the middle of the viewport, which is what the +/- buttons do. */
export function zoomAtCenter(view: SketchView, factor: number): SketchView {
  const scale = clampScale(view.scale * factor)
  const ratio = scale / view.scale
  return { scale, panX: view.panX * ratio, panY: view.panY * ratio }
}

/** Frame a model-space box, leaving `padding` pixels of margin on every side. */
export function frameBounds(min: Vec2, max: Vec2, size: ViewportSize, padding: number): SketchView {
  const width = max[0] - min[0]
  const height = max[1] - min[1]
  const scale = clampScale(Math.min(
    Math.max(1, size.width - padding * 2) / Math.max(width, 1),
    Math.max(1, size.height - padding * 2) / Math.max(height, 1),
  ))
  const center: Vec2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]
  return { scale, panX: -center[0] * scale, panY: center[1] * scale }
}
