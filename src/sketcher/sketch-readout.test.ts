import { describe, expect, it } from 'vitest'
import { drawingPreview, type DrawingGesture } from './sketch-drawing-preview'
import { normalizeDegrees, sketchReadout } from './sketch-readout'

const idle: DrawingGesture = {
  tool: 'line',
  start: null,
  cursor: [12, -3],
  snapped: false,
  angleSnap: 0,
  gridIncrement: 1,
  angleTolerance: 4,
  trimPreview: null,
  pendingArc: null,
  pendingThreePointArc: null,
  pendingTangentArc: null,
}

const readout = (gesture: Partial<DrawingGesture>) => sketchReadout(drawingPreview({ ...idle, ...gesture }), 'mm')

describe('sketchReadout', () => {
  it('says nothing with the pointer off the surface', () => {
    expect(readout({ cursor: null })).toBeNull()
  })

  it('shows the cursor position before a gesture starts', () => {
    expect(readout({})).toMatch(/^X 12.*Y -3/)
  })

  it('measures what is being drawn', () => {
    expect(readout({ tool: 'rectangle', start: [0, 0], cursor: [30, 20] })).toMatch(/^W 30.*H 20/)
    expect(readout({ tool: 'circle', start: [0, 0], cursor: [3, 4] })).toMatch(/^R 5/)
    expect(readout({ start: [0, 0], cursor: [0, 10] })).toMatch(/^L 10.*∠ 90\.0°$/)
  })

  it('names the next click for multi-click tools', () => {
    expect(readout({ tool: 'tangent-arc' })).toBe('Choose a line or arc endpoint')
    expect(readout({ tool: 'three-point-arc', pendingThreePointArc: { start: [0, 0] } })).toBe('Choose the arc end point')
    expect(readout({ tool: 'trim' })).toBe('Hover a curve to trim it back to a crossing')
    expect(readout({ tool: 'trim', trimPreview: [[0, 0], [1, 0]] })).toBe('Click to remove the highlighted piece')
  })

  it('gives a pending arc its radius and sweep', () => {
    expect(readout({ tool: 'arc', cursor: [0, 10], pendingArc: { center: [0, 0], start: [10, 0] } })).toMatch(/^R 10.*∠ 90\.0°$/)
  })
})

describe('normalizeDegrees', () => {
  it('folds any angle into (-180, 180]', () => {
    expect(normalizeDegrees(Math.PI)).toBeCloseTo(180)
    expect(normalizeDegrees(-Math.PI)).toBeCloseTo(180)
    expect(normalizeDegrees(Math.PI * 2.5)).toBeCloseTo(90)
    expect(normalizeDegrees(-Math.PI / 2)).toBeCloseTo(-90)
  })
})
