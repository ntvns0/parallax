import { describe, expect, it } from 'vitest'
import type { LineEntity } from '../core/model'
import { adaptiveRulerMultiplier, resolveSketchPoint } from './sketch-point-resolution'

const base = { scale: 4, displayUnits: 'mm' as const, gridIncrement: 1, rulerDatum: 'start' as const, attachment: undefined }
const line: LineEntity = { id: 'l', type: 'line', start: [0, 0], end: [20, 0], construction: false }

describe('resolveSketchPoint', () => {
  it('rounds to the grid when nothing else is near', () => {
    expect(resolveSketchPoint({ ...base, point: [3.4, 7.6], lines: [] })).toEqual({ point: [3, 8], snap: null, ruler: null })
  })

  it('prefers an endpoint of existing geometry to the grid', () => {
    const resolved = resolveSketchPoint({ ...base, point: [20.6, 0.4], lines: [line] })
    expect(resolved.point).toEqual([20, 0])
    expect(resolved.snap).toMatchObject({ source: 'entity', kind: 'endpoint' })
  })

  it('snaps to a face reference when one is closer than any geometry', () => {
    const attachment = {
      type: 'face' as const, featureId: 'e', featureName: 'Extrude 1', faceLabel: 'Top face',
      center: [50, 50] as [number, number], bounds: { min: [40, 40] as [number, number], max: [60, 60] as [number, number] }, edges: [], area: 400,
    }
    const resolved = resolveSketchPoint({ ...base, point: [50.7, 49.6], lines: [], attachment })
    expect(resolved.point).toEqual([50, 50])
    expect(resolved.snap).toMatchObject({ source: 'face' })
  })
})

describe('adaptiveRulerMultiplier', () => {
  it('leaves divisions alone when they are already far enough apart', () => {
    expect(adaptiveRulerMultiplier(40)).toBe(1)
  })

  it('steps through 1, 2, 5 as the view zooms out', () => {
    expect(adaptiveRulerMultiplier(20)).toBe(2)
    expect(adaptiveRulerMultiplier(9)).toBe(5)
    expect(adaptiveRulerMultiplier(3)).toBe(20)
  })
})
