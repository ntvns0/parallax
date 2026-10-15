import { describe, expect, it } from 'vitest'
import type { LineEntity, SketchFeature, SketchPlane } from './model'
import { revolveAxis, revolveAxisCandidates, revolveAxisInSketch } from './revolve-axis'

const centreline: LineEntity = { id: 'axis', type: 'line', start: [5, -10], end: [5, 30], construction: true }
const edge: LineEntity = { id: 'edge', type: 'line', start: [10, 0], end: [15, 0], construction: false }

function sketch(plane: SketchPlane, entities = [centreline, edge]): SketchFeature {
  return {
    id: 's', name: 'Section', kind: 'sketch', plane, entities, constraints: [],
    parameters: { planeOffset: 0 }, position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
  } as SketchFeature
}

describe('revolve axis', () => {
  it('offers only construction lines as centrelines', () => {
    expect(revolveAxisCandidates(sketch('XY')).map((line) => line.id)).toEqual(['axis'])
  })

  it('uses a sketch axis through the origin when no line is named', () => {
    expect(revolveAxisInSketch({ parameters: { angle: 360, axis: 'Y' } }, sketch('XY'))).toEqual({ origin: [0, 0], direction: [0, 1] })
    // On XZ, the sketch's Y axis is world Z.
    expect(revolveAxis({ parameters: { angle: 360, axis: 'Y' } }, sketch('XZ'), 0)).toEqual({ origin: [0, -0, 0], direction: [0, 0, 1] })
  })

  it('turns about a named centreline wherever it is drawn', () => {
    const revolve = { parameters: { angle: 360, axis: 'Y' as const }, axisEntityId: 'axis' }
    expect(revolveAxisInSketch(revolve, sketch('XY'))).toEqual({ origin: [5, -10], direction: [0, 1] })
    expect(revolveAxis(revolve, sketch('XZ'), 2)).toEqual({ origin: [5, -2, -10], direction: [0, 0, 1] })
  })

  it('has no axis once the named line is gone', () => {
    const revolve = { parameters: { angle: 360, axis: 'Y' as const }, axisEntityId: 'axis' }
    expect(revolveAxis(revolve, sketch('XY', [edge]), 0)).toBeNull()
  })
})
