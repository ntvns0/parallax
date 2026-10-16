import { describe, expect, it } from 'vitest'
import type { LineEntity, SketchFeature, SketchPlane } from './model'
import { axialPosition, revolveAxis, revolveAxisCandidates, revolveAxisInSketch, rotateAboutAxis } from './revolve-axis'

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

  it('turns a point about an axis by the right-hand rule', () => {
    const zAxis = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] }
    const quarter = rotateAboutAxis([10, 0, 4], zAxis, 90)
    expect(quarter[0]).toBeCloseTo(0, 9)
    expect(quarter[1]).toBeCloseTo(10, 9)
    expect(quarter[2]).toBeCloseTo(4, 9)
    // About an offset axis, the point keeps its height and its distance out.
    const offset = { origin: [5, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] }
    const half = rotateAboutAxis([8, 0, 2], offset, 180)
    expect(half[0]).toBeCloseTo(2, 9)
    expect(half[1]).toBeCloseTo(0, 9)
    expect(axialPosition(offset, half)).toEqual({ along: 2, radius: expect.closeTo(3, 9) })
  })
})
