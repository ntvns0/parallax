import { describe, expect, it } from 'vitest'
import { migrateStoredDocument, normalizeDocument } from './document-migration'
import { CURRENT_SCHEMA_VERSION, type CadDocument, type Feature } from './model'

/**
 * A stored part with one sketch and one extrusion built from it. `faceNormalSign`
 * present means the sketch was drawn on a face rather than a base plane.
 */
function storedDocument(schemaVersion: number, options: {
  faceNormalSign?: -1 | 1
  operation: 'newBody' | 'add' | 'cut'
  distance: number
}): CadDocument {
  const sketch: Feature = {
    id: 'sketch-1',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    parameters: { planeOffset: 20, faceNormalSign: options.faceNormalSign },
    entities: [{ id: 'c1', type: 'circle', center: [0, 0], radius: 5, construction: false }],
    constraints: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
  }
  const extrude: Feature = {
    id: 'extrude-1',
    kind: 'extrude',
    name: 'Extrude 1',
    parameters: { distance: options.distance, symmetric: false, edgeRadius: 0 },
    sketchId: 'sketch-1',
    operation: options.operation,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
  }
  return {
    schemaVersion,
    id: 'doc-1',
    name: 'Part',
    units: 'mm',
    displayUnits: 'mm',
    features: [sketch, extrude],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as CadDocument
}

const extrudeOf = (document: CadDocument) => document.features[1] as Extract<Feature, { kind: 'extrude' }>

describe('v4 to v5: face-attached cut direction', () => {
  it('turns an old face-attached cut inward so it stays a pocket', () => {
    // v4 stored a positive magnitude and let the boolean flip it at evaluation
    // time. If this is missed, every saved pocket reopens as a boss.
    const migrated = normalizeDocument(storedDocument(4, { faceNormalSign: 1, operation: 'cut', distance: 6 }))

    expect(extrudeOf(migrated).parameters.distance).toBe(-6)
    expect(extrudeOf(migrated).operation).toBe('cut')
  })

  it('migrates a cut on an inward-facing face the same way', () => {
    const migrated = normalizeDocument(storedDocument(4, { faceNormalSign: -1, operation: 'cut', distance: 6 }))

    expect(extrudeOf(migrated).parameters.distance).toBe(-6)
  })

  it('leaves a face-attached add alone, because its sign already agreed', () => {
    const migrated = normalizeDocument(storedDocument(4, { faceNormalSign: 1, operation: 'add', distance: 6 }))

    expect(extrudeOf(migrated).parameters.distance).toBe(6)
  })

  it('leaves a base-plane cut alone, where direction and boolean stay independent', () => {
    const migrated = normalizeDocument(storedDocument(4, { operation: 'cut', distance: 6 }))

    expect(extrudeOf(migrated).parameters.distance).toBe(6)
  })

  it('does not re-flip a document already saved at v5', () => {
    // Running the migration twice must not turn a pocket back into a boss.
    const migrated = normalizeDocument(storedDocument(CURRENT_SCHEMA_VERSION, { faceNormalSign: 1, operation: 'cut', distance: -6 }))

    expect(extrudeOf(migrated).parameters.distance).toBe(-6)
  })

  it('is idempotent across a save and reopen cycle', () => {
    const once = normalizeDocument(storedDocument(4, { faceNormalSign: 1, operation: 'cut', distance: 6 }))
    const twice = normalizeDocument(once)

    expect(extrudeOf(twice).parameters.distance).toBe(-6)
  })
})

describe('v5 to v6: fillet edge anchors', () => {
  /** A pocket with a fillet on one of its corners, saved before anchors existed. */
  function filletedPocket(schemaVersion: number): CadDocument {
    const corners: [number, number][] = [[-20, -12], [20, -12], [20, 12], [-20, 12]]
    return {
      schemaVersion,
      id: 'doc-1', name: 'Part', units: 'mm', displayUnits: 'mm',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      features: [
        {
          id: 'sketch-2', kind: 'sketch', name: 'Sketch 2', plane: 'XY',
          parameters: { planeOffset: 20, faceNormalSign: 1 },
          entities: corners.map((corner, index) => ({
            id: `line-${index}`, type: 'line', start: corner, end: corners[(index + 1) % 4], construction: false,
          })),
          constraints: [], position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
        },
        {
          id: 'extrude-2', kind: 'extrude', name: 'Extrude 2',
          parameters: { distance: -6, symmetric: false, edgeRadius: 0 },
          sketchId: 'sketch-2', operation: 'cut',
          position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
        },
        {
          id: 'fillet-1', kind: 'fillet', name: 'Fillet 1', parameters: { radius: 2 },
          edges: [{ start: [20, -12, 20], end: [20, -12, 14], point: [20, -12, 17] }],
          position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
        },
      ],
    } as CadDocument
  }

  const filletOf = (document: CadDocument) => document.features[2] as Extract<Feature, { kind: 'fillet' }>

  it('anchors a fillet saved before anchors existed', () => {
    // Saved parts gain this retroactively; the anchor is derived from the
    // stored coordinates and the profile, with no solid needed.
    const migrated = normalizeDocument(filletedPocket(5))

    expect(filletOf(migrated).edges[0].anchor).toMatchObject({
      kind: 'profileLateral',
      sketchId: 'sketch-2',
    })
  })

  it('keeps the recorded coordinates as the fallback', () => {
    const migrated = normalizeDocument(filletedPocket(5))

    expect(filletOf(migrated).edges[0].start).toEqual([20, -12, 20])
  })

  it('is idempotent', () => {
    const once = normalizeDocument(filletedPocket(5))
    const twice = normalizeDocument(once)

    expect(filletOf(twice).edges[0]).toEqual(filletOf(once).edges[0])
  })
})

describe('migrateStoredDocument', () => {
  it('opens a v4 part and stamps it to the current schema', () => {
    const migrated = migrateStoredDocument(storedDocument(4, { faceNormalSign: 1, operation: 'cut', distance: 6 }))

    expect(migrated).not.toBeNull()
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(extrudeOf(migrated!).parameters.distance).toBe(-6)
  })

  it('refuses a schema this build does not know', () => {
    expect(migrateStoredDocument(storedDocument(99, { operation: 'newBody', distance: 6 }))).toBeNull()
  })
})
