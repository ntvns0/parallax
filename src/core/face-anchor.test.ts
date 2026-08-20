import { describe, expect, it } from 'vitest'
import { currentPlaneOffset, deriveFaceAnchor, resolveFaceOffset } from './face-anchor'
import { buildOperationChain } from '../kernel/operation-chain'
import {
  createExtrudeFeature,
  createFeature,
  createId,
  type CadDocument,
  type Feature,
  type SketchFaceAttachment,
  type SketchFeature,
  type Vec2,
} from './model'
import { normalizeDocument } from './document-migration'
import { collectFaceReferenceDiagnostics } from './diagnostics'

function rectangleSketch(plane: 'XY' | 'XZ' | 'YZ' = 'XY', size = 40): SketchFeature {
  const sketch = createFeature('sketch', 1, plane) as SketchFeature
  const points: Vec2[] = [[0, 0], [size, 0], [size, size], [0, size]]
  sketch.entities = points.map((start, index) => ({
    id: createId(),
    type: 'line' as const,
    start,
    end: points[(index + 1) % points.length],
    construction: false,
  }))
  return sketch
}

function attachment(featureId: string): SketchFaceAttachment {
  return {
    type: 'face',
    featureId,
    featureName: 'Extrude 1',
    faceLabel: 'Top face',
    center: [20, 20],
    bounds: { min: [0, 0], max: [40, 40] },
    edges: [],
    area: 1600,
  }
}

/**
 * A plate, and a sketch drawn on its top face.
 *
 * The second sketch sits at the far end of the first extrusion's sweep, which
 * is the arrangement every face-attached feature is built on.
 */
function plateWithFaceSketch(depth = 10) {
  const base = rectangleSketch()
  const extrude = createExtrudeFeature(base.id, 1, depth)
  const onFace = rectangleSketch('XY', 20)
  onFace.parameters.planeOffset = depth
  onFace.parameters.faceNormalSign = 1
  onFace.attachment = attachment(extrude.id)
  return { base, extrude, onFace, features: [base, extrude, onFace] as Feature[] }
}

describe('deriveFaceAnchor', () => {
  it('names the far cap of the extrusion the sketch sits on', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    expect(deriveFaceAnchor(onFace, features)).toEqual({ kind: 'extrudeCap', featureId: extrude.id, depth: 1 })
  })

  it('names the near cap when the sketch sits on the starting plane', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    onFace.parameters.planeOffset = 0
    expect(deriveFaceAnchor(onFace, features)).toEqual({ kind: 'extrudeCap', featureId: extrude.id, depth: 0 })
  })

  it('finds nothing when no sweep end reaches that height', () => {
    const { onFace, features } = plateWithFaceSketch()
    onFace.parameters.planeOffset = 37
    expect(deriveFaceAnchor(onFace, features)).toBeUndefined()
  })

  it('ignores extrusions built on a different plane', () => {
    const { onFace, features } = plateWithFaceSketch()
    const sideways = rectangleSketch('XZ')
    features.push(sideways, createExtrudeFeature(sideways.id, 2, 10))
    expect(deriveFaceAnchor(onFace, features)?.depth).toBe(1)
  })

  it('prefers the most recent extrusion when two end at the same height', () => {
    const { onFace, features } = plateWithFaceSketch()
    const second = rectangleSketch()
    const secondExtrude = createExtrudeFeature(second.id, 2, 10)
    features.splice(2, 0, second, secondExtrude)
    expect(deriveFaceAnchor(onFace, features)?.featureId).toBe(secondExtrude.id)
  })
})

describe('currentPlaneOffset', () => {
  // The failure this whole module exists to prevent: the sketch used to stay
  // at 10 while the face it was drawn on moved to 25.
  it('follows the face when the extrusion under it gets deeper', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    onFace.attachment!.anchor = deriveFaceAnchor(onFace, features)
    expect(currentPlaneOffset(onFace, features)).toBe(10)

    extrude.parameters.distance = 25
    expect(currentPlaneOffset(onFace, features)).toBe(25)
  })

  it('follows a symmetric extrusion, whose cap is half its depth out', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    onFace.attachment!.anchor = deriveFaceAnchor(onFace, features)
    extrude.parameters.symmetric = true
    expect(currentPlaneOffset(onFace, features)).toBe(5)
  })

  it('keeps the stored offset for a sketch on a base plane', () => {
    const { base, features } = plateWithFaceSketch()
    base.parameters.planeOffset = 3
    expect(currentPlaneOffset(base, features)).toBe(3)
  })

  it('falls back to the stored offset when the host feature is gone', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    onFace.attachment!.anchor = deriveFaceAnchor(onFace, features)
    const without = features.filter((feature) => feature.id !== extrude.id)
    expect(currentPlaneOffset(onFace, without)).toBe(10)
    expect(collectFaceReferenceDiagnostics(without)[onFace.id]).toMatchObject({
      code: 'unresolved-face',
      reason: 'missing',
      subject: { kind: 'face', id: extrude.id },
      repairs: expect.arrayContaining([expect.objectContaining({ kind: 'restore-feature', featureId: extrude.id })]),
    })
  })

  it('resolves a sketch stacked on a face of a face-attached feature', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    onFace.attachment!.anchor = deriveFaceAnchor(onFace, features)
    const boss = createExtrudeFeature(onFace.id, 2, 6)
    features.push(boss)

    const top = rectangleSketch('XY', 10)
    top.parameters.planeOffset = 16
    top.parameters.faceNormalSign = 1
    top.attachment = { ...attachment(boss.id), anchor: { kind: 'extrudeCap', featureId: boss.id, depth: 1 } }
    features.push(top)

    expect(currentPlaneOffset(top, features)).toBe(16)
    // Deepen the plate: both the boss and the sketch on top of it move with it.
    extrude.parameters.distance = 30
    expect(currentPlaneOffset(top, features)).toBe(36)
  })

  it('does not hang on a document edited into a cycle', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    const base = features[0] as SketchFeature
    onFace.attachment!.anchor = { kind: 'extrudeCap', featureId: extrude.id, depth: 1 }
    // The extrusion's own sketch now claims to sit on the face that extrusion
    // makes, which is impossible but must not spin.
    base.attachment = { ...attachment(extrude.id), anchor: { kind: 'extrudeCap', featureId: extrude.id, depth: 1 } }
    expect(() => currentPlaneOffset(onFace, features)).not.toThrow()
    expect(Number.isFinite(currentPlaneOffset(onFace, features))).toBe(true)
  })

  it('returns null for an anchor naming something that is not an extrusion', () => {
    const { onFace, features } = plateWithFaceSketch()
    expect(resolveFaceOffset({ kind: 'extrudeCap', featureId: onFace.id, depth: 1 }, features)).toBeNull()
  })
})

describe('the kernel sees the resolved offset', () => {
  it('sends the moved plane to the kernel after the host changes', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    onFace.attachment!.anchor = deriveFaceAnchor(onFace, features)
    const pocket = createExtrudeFeature(onFace.id, 2, -4)
    features.push(pocket)

    extrude.parameters.distance = 25
    const chain = buildOperationChain(pocket, features)
    const operation = chain.find((step) => step.featureId === pocket.id)
    expect(operation && 'planeOffset' in operation ? operation.planeOffset : null).toBe(25)
  })
})

describe('migration', () => {
  it('backfills an anchor onto a face sketch saved before v7', () => {
    const { extrude, onFace, features } = plateWithFaceSketch()
    const stored = {
      schemaVersion: 6,
      id: 'doc',
      name: 'Part',
      displayUnits: 'mm',
      updatedAt: new Date().toISOString(),
      features,
    } as unknown as CadDocument

    const migrated = normalizeDocument(stored)
    const sketch = migrated.features.find((feature) => feature.id === onFace.id)
    expect(sketch?.kind === 'sketch' && sketch.attachment?.anchor)
      .toEqual({ kind: 'extrudeCap', featureId: extrude.id, depth: 1 })
  })
})
