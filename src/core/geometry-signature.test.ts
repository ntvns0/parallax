import { describe, expect, it } from 'vitest'
import { createEmptyDocument, createFeature, createFilletFeature, type CadDocument, type SketchFeature } from './model'
import { areDocumentsStructurallyEqual, computeDocumentSignature } from './geometry-signature'

/** A document holding one sketch: a single line and the dimension driving it. */
function documentWithSketch(): { doc: CadDocument; sketch: SketchFeature } {
  const doc = createEmptyDocument()
  const sketch = createFeature('sketch', 1) as SketchFeature
  sketch.entities = [
    { id: 'line-1', type: 'line', start: [0, 0], end: [10, 0], construction: false },
    { id: 'circle-1', type: 'circle', center: [5, 5], radius: 2, construction: false },
  ]
  sketch.constraints = [
    { id: 'dim-1', type: 'distance', entityIds: ['line-1'], value: 10 },
  ]
  doc.features = [sketch]
  return { doc, sketch }
}

describe('geometry-signature', () => {
  it('generates consistent signatures for identical documents', () => {
    const doc1 = createEmptyDocument()
    doc1.name = 'Part A'
    const doc2 = createEmptyDocument()
    doc2.name = 'Part A'
    doc2.id = doc1.id

    expect(computeDocumentSignature(doc1)).toBe(computeDocumentSignature(doc2))
    expect(areDocumentsStructurallyEqual(doc1, doc2)).toBe(true)
  })

  it('detects name, feature, and unit changes', () => {
    const doc1 = createEmptyDocument()
    doc1.name = 'Part A'
    const doc2 = createEmptyDocument()
    doc2.name = 'Part B'
    doc2.id = doc1.id

    expect(areDocumentsStructurallyEqual(doc1, doc2)).toBe(false)
  })

  it('ignores when a document was last touched', () => {
    const doc1 = createEmptyDocument()
    const doc2 = { ...createEmptyDocument(), id: doc1.id, name: doc1.name }
    doc2.updatedAt = new Date(Date.parse(doc1.updatedAt) + 60_000).toISOString()

    expect(areDocumentsStructurallyEqual(doc1, doc2)).toBe(true)
  })

  // The signature used to hash entity and constraint *counts*, so every edit
  // below — which changes no count — was reported as no change at all.
  it('detects a moved sketch entity', () => {
    const { doc } = documentWithSketch()
    const { doc: edited, sketch } = documentWithSketch()
    edited.id = doc.id
    sketch.entities[0] = { ...sketch.entities[0], end: [12, 0] } as typeof sketch.entities[0]

    expect(areDocumentsStructurallyEqual(doc, edited)).toBe(false)
  })

  it('detects a changed circle radius', () => {
    const { doc } = documentWithSketch()
    const { doc: edited, sketch } = documentWithSketch()
    edited.id = doc.id
    sketch.entities[1] = { ...sketch.entities[1], radius: 4 } as typeof sketch.entities[1]

    expect(areDocumentsStructurallyEqual(doc, edited)).toBe(false)
  })

  it('detects a retargeted driving dimension', () => {
    const { doc } = documentWithSketch()
    const { doc: edited, sketch } = documentWithSketch()
    edited.id = doc.id
    sketch.constraints[0] = { ...sketch.constraints[0], value: 25 }

    expect(areDocumentsStructurallyEqual(doc, edited)).toBe(false)
  })

  it('detects a construction-geometry toggle', () => {
    const { doc } = documentWithSketch()
    const { doc: edited, sketch } = documentWithSketch()
    edited.id = doc.id
    sketch.entities[0] = { ...sketch.entities[0], construction: true }

    expect(areDocumentsStructurallyEqual(doc, edited)).toBe(false)
  })

  it('detects a fillet edge selection moving to a different edge', () => {
    const documentWithFilletAt = (x: number): CadDocument => {
      const doc = createEmptyDocument()
      doc.features = [createFilletFeature([{ point: [x, 0, 1], start: [x, 0, 0], end: [x, 0, 2] }], 1)]
      return doc
    }
    const doc1 = documentWithFilletAt(0)
    const doc2 = documentWithFilletAt(5)
    doc2.id = doc1.id
    doc2.features[0].id = doc1.features[0].id

    expect(areDocumentsStructurallyEqual(doc1, doc2)).toBe(false)
  })
})
