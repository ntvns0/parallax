import { describe, expect, it } from 'vitest'
import { createEmptyDocument, createExtrudeFeature, createFeature, validateCadDocument } from './model'

describe('project validation', () => {
  it('accepts a well-formed sketch and extrusion dependency', () => {
    const document = createEmptyDocument()
    const sketch = createFeature('sketch', 1, 'XZ')
    const extrusion = createExtrudeFeature(sketch.id, 1, 12)
    document.features.push(sketch, extrusion)

    expect(validateCadDocument(document)).toEqual({ valid: true, errors: [] })
  })

  it('rejects broken dependencies and zero-volume extrusions', () => {
    const document = createEmptyDocument()
    document.features.push(createExtrudeFeature('missing-sketch', 1, 0))

    const result = validateCadDocument(document)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('missing sketch'),
      expect.stringContaining('invalid distance'),
    ]))
  })
})
