import { describe, expect, it } from 'vitest'
import { validateCadDocument } from '../core/model'
import { createLinearPartFixture } from './model-fixtures'

describe('performance model fixtures', () => {
  it('builds a deterministic valid linear history at the requested size', () => {
    const fixture = createLinearPartFixture(250)

    expect(fixture.features).toHaveLength(500)
    expect(validateCadDocument(fixture)).toEqual({ valid: true, errors: [] })
    expect(createLinearPartFixture(250)).toEqual(fixture)
  })
})
