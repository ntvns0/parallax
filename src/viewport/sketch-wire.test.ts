import { describe, expect, it } from 'vitest'
import type { SketchEntity, SketchFeature, SketchPlane } from '../core/model'
import { sketchWirePositions } from './sketch-wire'

function sketch(plane: SketchPlane, planeOffset: number, entities: SketchEntity[]): SketchFeature {
  return {
    id: 's', name: 'Sketch', kind: 'sketch', plane, entities, constraints: [],
    parameters: { planeOffset }, position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
  } as SketchFeature
}

const line: SketchEntity = { id: 'l', type: 'line', start: [1, 2], end: [3, 4], construction: false }

describe('sketchWirePositions', () => {
  it('lifts a line onto each plane at its offset', () => {
    expect(sketchWirePositions(sketch('XY', 5, [line])).profile).toEqual([1, 2, 5, 3, 4, 5])
    expect(sketchWirePositions(sketch('XZ', 5, [line])).profile).toEqual([1, -5, 2, 3, -5, 4])
    expect(sketchWirePositions(sketch('YZ', 5, [line])).profile).toEqual([5, 1, 2, 5, 3, 4])
  })

  it('cuts a circle into 96 segments that close on themselves', () => {
    const circle: SketchEntity = { id: 'c', type: 'circle', center: [0, 0], radius: 10, construction: false }
    const positions = sketchWirePositions(sketch('XY', 0, [circle])).profile
    expect(positions).toHaveLength(96 * 2 * 3)
    expect(positions.slice(0, 3)).toEqual([10, 0, 0])
    expect(positions.at(-3)).toBeCloseTo(10)
    expect(positions.at(-2)).toBeCloseTo(0)
  })

  it('cuts an arc in proportion to its sweep, and a short one into at least 8', () => {
    const quarter: SketchEntity = { id: 'a', type: 'arc', center: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 2, construction: false }
    expect(sketchWirePositions(sketch('XY', 0, [quarter])).profile).toHaveLength(24 * 2 * 3)
    const sliver: SketchEntity = { ...quarter, endAngle: 0.01 } as SketchEntity
    expect(sketchWirePositions(sketch('XY', 0, [sliver])).profile).toHaveLength(8 * 2 * 3)
  })

  it('keeps construction geometry apart, to be drawn dashed', () => {
    const wire = sketchWirePositions(sketch('XY', 0, [line, { ...line, id: 'c', construction: true }]))
    expect(wire.profile).toHaveLength(6)
    expect(wire.construction).toHaveLength(6)
  })
})
