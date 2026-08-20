import { describe, expect, it } from 'vitest'
import { describeModelParameters } from './model-parameters'
import { createExtrudeFeature, type DocumentParameter } from '../core/model'

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
