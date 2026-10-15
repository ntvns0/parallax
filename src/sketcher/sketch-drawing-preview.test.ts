import { describe, expect, it } from 'vitest'
import { drawingPreview, type DrawingGesture } from './sketch-drawing-preview'

const idle: DrawingGesture = {
  tool: 'line',
  start: null,
  cursor: null,
  snapped: false,
  angleSnap: 0,
  gridIncrement: 1,
  angleTolerance: 4,
  trimPreview: null,
  pendingArc: null,
  pendingThreePointArc: null,
  pendingTangentArc: null,
}

describe('drawingPreview', () => {
  it('previews a nearly horizontal line as horizontal, and says so', () => {
    const preview = drawingPreview({ ...idle, start: [0, 0], cursor: [20.3, 0.6] })
    expect(preview.previewEnd![1]).toBeCloseTo(0)
    expect(preview.previewAngleSnap).toBeCloseTo(0)
  })

  it('leaves a snapped line end exactly on its snap target', () => {
    const preview = drawingPreview({ ...idle, start: [0, 0], cursor: [20.3, 0.6], snapped: true })
    expect(preview.previewEnd).toEqual([20.3, 0.6])
  })

  it('only infers angles for lines', () => {
    const preview = drawingPreview({ ...idle, tool: 'rectangle', start: [0, 0], cursor: [20.3, 0.6] })
    expect(preview.previewEnd).toEqual([20.3, 0.6])
    expect(preview.previewAngleSnap).toBeNull()
  })

  it('sweeps a pending centre-point arc to the cursor', () => {
    const preview = drawingPreview({ ...idle, tool: 'arc', cursor: [0, 10], pendingArc: { center: [0, 0], start: [10, 0] } })
    expect(preview.pendingArcPreview!.radius).toBeCloseTo(10)
    expect(preview.pendingArcPreview!.endAngle - preview.pendingArcPreview!.startAngle).toBeCloseTo(Math.PI / 2)
  })

  it('has no three-point arc until both ends are chosen', () => {
    const halfway = drawingPreview({ ...idle, tool: 'three-point-arc', cursor: [5, 5], pendingThreePointArc: { start: [0, 0] } })
    expect(halfway.threePointArcPreview).toBeNull()
    const ready = drawingPreview({
      ...idle, tool: 'three-point-arc', cursor: [5, 5], pendingThreePointArc: { start: [0, 0], end: [10, 0] },
    })
    expect(ready.threePointArcPreview!.radius).toBeCloseTo(5)
  })
})
