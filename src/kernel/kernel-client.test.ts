import { describe, expect, it } from 'vitest'
import { operationChainCacheKey } from './operation-chain'
import type { KernelOperation } from './kernel-types'

describe('KernelClient cache key isolation', () => {
  it('generates identical cache keys when featureName changes', () => {
    const op1: KernelOperation = {
      type: 'extrude',
      featureId: 'ext-1',
      featureName: 'Extrude 1',
      sketchId: 'sk-1',
      regions: [],
      plane: 'XY',
      planeOffset: 0,
      distance: 10,
      symmetric: false,
      operation: 'newBody',
      edgeRadius: 0,
    }

    const op2: KernelOperation = {
      ...op1,
      featureName: 'Renamed Feature',
    }

    expect(operationChainCacheKey([op1])).toBe(operationChainCacheKey([op2]))
  })

  it('generates different cache keys when geometry changes', () => {
    const op1: KernelOperation = {
      type: 'extrude',
      featureId: 'ext-1',
      featureName: 'Extrude 1',
      sketchId: 'sk-1',
      regions: [],
      plane: 'XY',
      planeOffset: 0,
      distance: 10,
      symmetric: false,
      operation: 'newBody',
      edgeRadius: 0,
    }

    const op2: KernelOperation = {
      ...op1,
      distance: 25,
    }

    expect(operationChainCacheKey([op1])).not.toBe(operationChainCacheKey([op2]))
  })
})
