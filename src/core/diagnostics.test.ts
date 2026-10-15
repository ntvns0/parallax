import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDiagnostics, collectOpenProfileDiagnostics, findDiagnosticRepair, logDiagnostic, readDiagnostics, recordFeatureDiagnostics, useFeatureDiagnosticsStore, type FeatureDiagnostic } from './diagnostics'
import { createExtrudeFeature, createFeature, createRevolveFeature, type SketchFeature, type Vec2 } from './model'

describe('persistent diagnostics', () => {
  beforeEach(() => {
    localStorage.clear()
    useFeatureDiagnosticsStore.setState({ unresolved: {} })
    vi.restoreAllMocks()
  })

  it('uses one feature-issue lifecycle across evaluators', () => {
    const diagnostic: FeatureDiagnostic = {
      featureId: 'fillet-1', featureName: 'Fillet 1', severity: 'warning',
      code: 'oversized-fillet', reason: 'limit-exceeded',
      subject: { kind: 'parameter', label: 'Fillet radius' },
      message: 'Radius is too large.',
      repairs: [{ kind: 'apply-radius', label: 'Apply suggested radius', value: 2.5 }],
    }
    recordFeatureDiagnostics(['fillet-1'], [diagnostic])
    expect(useFeatureDiagnosticsStore.getState().unresolved['fillet-1']).toEqual(diagnostic)
    expect(findDiagnosticRepair(diagnostic, 'apply-radius')?.value).toBe(2.5)

    recordFeatureDiagnostics(['fillet-1'], [])
    expect(useFeatureDiagnosticsStore.getState().unresolved['fillet-1']).toBeUndefined()
  })

  it('stores structured errors and clears them', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    logDiagnostic('error', 'Exact geometry', 'A boolean operation failed.', {
      rawKernelError: '31272248',
      featureName: 'Extrude 4',
    })

    expect(readDiagnostics()).toMatchObject([{
      level: 'error',
      area: 'Exact geometry',
      message: 'A boolean operation failed.',
      context: { rawKernelError: '31272248', featureName: 'Extrude 4' },
    }])

    clearDiagnostics()
    expect(readDiagnostics()).toEqual([])
  })

  it('keeps only the most recent 100 entries', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    for (let index = 0; index < 105; index += 1) logDiagnostic('info', 'Test', `Entry ${index}`)

    const entries = readDiagnostics()
    expect(entries).toHaveLength(100)
    expect(entries[0].message).toBe('Entry 104')
    expect(entries.at(-1)?.message).toBe('Entry 5')
  })
})

describe('open-profile diagnostics', () => {
  function sketchOf(closed: boolean): SketchFeature {
    const sketch = createFeature('sketch', 1) as SketchFeature
    const corners: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    sketch.entities = corners.slice(0, closed ? 4 : 3).map((start, index) => ({
      id: `line-${index}`, type: 'line', start, end: corners[(index + 1) % 4], construction: false,
    }))
    return sketch
  }

  it('reports a sweep whose sketch stopped forming a closed profile, and offers to edit it', () => {
    // The operation chain skips such a sweep, so without this the part simply
    // loses a feature and nothing says why.
    const sketch = sketchOf(false)
    const extrude = createExtrudeFeature(sketch.id, 1, 5)
    const found = collectOpenProfileDiagnostics([sketch, extrude])

    expect(found[extrude.id]).toMatchObject({ code: 'open-profile', featureId: extrude.id })
    expect(findDiagnosticRepair(found[extrude.id], 'edit-sketch')?.sketchId).toBe(sketch.id)
  })

  it('reports revolves the same way', () => {
    const sketch = sketchOf(false)
    const revolve = createRevolveFeature(sketch.id, 1)
    expect(collectOpenProfileDiagnostics([sketch, revolve])[revolve.id]?.code).toBe('open-profile')
  })

  it('stays quiet for a closed profile', () => {
    const sketch = sketchOf(true)
    expect(collectOpenProfileDiagnostics([sketch, createExtrudeFeature(sketch.id, 1, 5)])).toEqual({})
  })
})
