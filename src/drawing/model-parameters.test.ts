import { describe, expect, it } from 'vitest'
import { describeModelParameters } from './model-parameters'
import { createExtrudeFeature, createFilletFeature, createHoleFeature, type DocumentParameter, type SketchFeature } from '../core/model'
import { applyHolePreset, defaultHoleParameters } from '../core/hole'

const format = (mm: number) => String(Math.round(mm * 100) / 100)

describe('describeModelParameters with named parameters', () => {
  const parameters: DocumentParameter[] = [
    { id: '1', name: 'plate', expression: '18' },
    { id: '2', name: 'boss', expression: 'plate * 2' },
    { id: '3', name: 'broken', expression: 'gone + 1' },
  ]

  it('leads the table with the named parameters, showing derived formulas', () => {
    const rows = describeModelParameters([createExtrudeFeature('s1', 1, 24)], format, parameters)
    expect(rows.slice(0, 3)).toEqual([
      // A literal prints as a value; a formula prints as intent and value both.
      { label: 'plate', value: '18' },
      { label: 'boss', value: 'plate * 2 = 36' },
      { label: 'broken', value: 'gone + 1 (unresolved)' },
    ])
    expect(rows[3]).toEqual({ label: 'Extrude 1 depth', value: '24' })
  })

  it('leaves the table as it was when a document has no parameters', () => {
    expect(describeModelParameters([createExtrudeFeature('s1', 1, 24)], format)).toEqual([
      { label: 'Extrude 1 depth', value: '24' },
    ])
  })
})

describe('describeModelParameters for holes and chamfers', () => {
  it('calls a hole out by its preset and sizes, with how many there are', () => {
    const points = {
      id: 'pts', kind: 'sketch', name: 'Holes', plane: 'XY', parameters: { planeOffset: 0 }, constraints: [],
      entities: [[0, 0], [10, 0]].map(([x, y], index) => ({ id: `p${index}`, type: 'point', position: [x, y], construction: false })),
      position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    } as SketchFeature
    const hole = createHoleFeature('pts', 1, { ...applyHolePreset(defaultHoleParameters(), 'M4 countersink'), through: true })
    expect(describeModelParameters([points, hole], format)).toEqual([{ label: 'Hole 1 ×2', value: 'M4 countersink: Ø4.5 THRU ⌵ Ø8.6 × 90°' }])
  })

  it('gives a chamfer its distance, not a radius', () => {
    const chamfer = createFilletFeature([], 1, 1.5, { blend: 'chamfer' })
    expect(describeModelParameters([chamfer], format)).toEqual([{ label: 'Chamfer 1 distance', value: '1.5 × 45°' }])
  })
})
