import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../core/model'
import {
  MAX_SCALE,
  MIN_SCALE,
  frameBounds,
  modelToScreen,
  screenToModel,
  zoomAtCenter,
  zoomAtScreenPoint,
  type SketchView,
} from './sketch-view'

const size = { width: 800, height: 600 }
const view: SketchView = { scale: 4, panX: -30, panY: 15 }

describe('sketch view transform', () => {
  it('puts the model origin at the panned centre of the viewport', () => {
    expect(modelToScreen(view, size, [0, 0])).toEqual([370, 315])
  })

  it('points model +Y up the screen', () => {
    const [, originY] = modelToScreen(view, size, [0, 0])
    const [, aboveY] = modelToScreen(view, size, [0, 10])
    expect(aboveY).toBeLessThan(originY)
  })

  it('round-trips model and screen coordinates', () => {
    for (const point of [[0, 0], [12.5, -40], [-333, 921]] as Vec2[]) {
      const roundTripped = screenToModel(view, size, modelToScreen(view, size, point))
      expect(roundTripped[0]).toBeCloseTo(point[0], 9)
      expect(roundTripped[1]).toBeCloseTo(point[1], 9)
    }
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const cursor: Vec2 = [610, 120]
    const before = screenToModel(view, size, cursor)
    const zoomed = zoomAtScreenPoint(view, size, cursor, 1.8)
    const after = screenToModel(zoomed, size, cursor)

    expect(zoomed.scale).toBeCloseTo(7.2, 9)
    expect(after[0]).toBeCloseTo(before[0], 9)
    expect(after[1]).toBeCloseTo(before[1], 9)
  })

  it('keeps the viewport centre fixed when zooming from the centre', () => {
    const centre: Vec2 = [size.width / 2, size.height / 2]
    const before = screenToModel(view, size, centre)
    const after = screenToModel(zoomAtCenter(view, 0.5), size, centre)
    expect(after[0]).toBeCloseTo(before[0], 9)
    expect(after[1]).toBeCloseTo(before[1], 9)
  })

  it('clamps zoom at both ends without moving the anchor off the rails', () => {
    expect(zoomAtScreenPoint(view, size, [10, 10], 1000).scale).toBe(MAX_SCALE)
    expect(zoomAtScreenPoint(view, size, [10, 10], 0.0001).scale).toBe(MIN_SCALE)
    expect(zoomAtCenter(view, 1000).scale).toBe(MAX_SCALE)
  })

  it('frames a box at the centre of the viewport', () => {
    const framed = frameBounds([10, 10], [50, 30], size, 100)
    const centre = modelToScreen(framed, size, [30, 20])
    expect(centre[0]).toBeCloseTo(size.width / 2, 9)
    expect(centre[1]).toBeCloseTo(size.height / 2, 9)
  })

  it('fits the framed box inside the padded viewport', () => {
    const min: Vec2 = [-25, -8]
    const max: Vec2 = [25, 8]
    const padding = 100
    const framed = frameBounds(min, max, size, padding)

    const left = modelToScreen(framed, size, min)[0]
    const right = modelToScreen(framed, size, max)[0]
    expect(right - left).toBeLessThanOrEqual(size.width - padding * 2 + 1e-9)
  })
})
