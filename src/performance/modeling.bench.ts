import { bench, describe } from 'vitest'
import { computeDocumentSignature } from '../core/geometry-signature'
import type { ExtrudeFeature } from '../core/model'
import { buildOperationChain, operationChainCacheKey } from '../kernel/operation-chain'
import { createLinearPartFixture } from './model-fixtures'

const document = createLinearPartFixture(250)
const finalFeature = document.features.at(-1) as ExtrudeFeature

describe('250-step linear part', () => {
  bench('compute document signature', () => {
    computeDocumentSignature(document)
  })

  bench('build operation chain and cache key', () => {
    operationChainCacheKey(buildOperationChain(finalFeature, document.features))
  })
})
