import { describe, expect, it } from 'vitest'
import { deriveClientPolicy, type ClientFacts } from './client-runtime'

function facts(overrides: Partial<ClientFacts> = {}): ClientFacts {
  return {
    logicalProcessors: null, deviceMemoryGiB: null, reducedMotion: false,
    coarsePointer: false, crossOriginIsolated: false, sharedArrayBuffer: false,
    opfs: false, ...overrides,
  }
}

describe('deriveClientPolicy', () => {
  it('uses conservative limits for constrained clients', () => {
    expect(deriveClientPolicy(facts({ logicalProcessors: 4 })).profile).toBe('conservative')
    expect(deriveClientPolicy(facts({ deviceMemoryGiB: 4 })).kernel.meshCacheBytes).toBe(48 * 1024 * 1024)
  })

  it('uses capable limits only with both CPU and memory evidence', () => {
    expect(deriveClientPolicy(facts({ logicalProcessors: 12, deviceMemoryGiB: 16 })).profile).toBe('capable')
    expect(deriveClientPolicy(facts({ logicalProcessors: 12 })).profile).toBe('balanced')
  })
})
