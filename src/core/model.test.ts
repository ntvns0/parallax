import { describe, expect, it } from 'vitest'
import { createEmptyDocument, createExtrudeFeature, createFeature, createId, validateCadDocument } from './model'

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

describe('createId', () => {
  it('makes a version 4 UUID even where crypto.randomUUID is missing, as over plain http', () => {
    const original = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const ids = new Set(Array.from({ length: 50 }, () => createId()))
      expect(ids.size).toBe(50)
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})
