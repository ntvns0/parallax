import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDiagnostics, findDiagnosticRepair, logDiagnostic, readDiagnostics, recordFeatureDiagnostics, useFeatureDiagnosticsStore, type FeatureDiagnostic } from './diagnostics'

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
