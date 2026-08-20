import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from './model'
import { migrateLegacyStorage, readDocument, readRecoverySnapshots, readWorkspace } from './project-storage'

function legacyDocument(id: string, name: string, schemaVersion = 2) {
  return {
    schemaVersion,
    id,
    name,
    units: 'mm',
    features: [{
      id: `${id}-box`,
      kind: 'box',
      name: 'Box 1',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      parameters: { width: 40, depth: 40, height: 24 },
    }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
}

describe('legacy storage migration', () => {
  it('moves localStorage projects into IndexedDB and reclaims the quota', async () => {
    localStorage.setItem('parallax.document.v2.alpha', JSON.stringify(legacyDocument('alpha', 'Alpha')))
    localStorage.setItem('parallax.document.v2.beta', JSON.stringify(legacyDocument('beta', 'Beta')))
    localStorage.setItem('parallax.workspace.v1', JSON.stringify({
      schemaVersion: 1,
      activeDocumentId: 'beta',
      projects: [{ id: 'beta', name: 'Beta', updatedAt: '2026-01-02T00:00:00.000Z' }],
    }))
    localStorage.setItem('parallax.recovery.v1.alpha', JSON.stringify([
      { id: 'snap-1', savedAt: '2026-01-01T12:00:00.000Z', document: legacyDocument('alpha', 'Alpha before') },
    ]))

    const result = await migrateLegacyStorage()

    expect(result).toEqual({ migratedProjects: 2, migratedSnapshots: 1 })
    expect((await readDocument('alpha'))?.name).toBe('Alpha')
    expect((await readDocument('beta'))?.name).toBe('Beta')
    expect((await readWorkspace())?.activeDocumentId).toBe('beta')
    expect(await readRecoverySnapshots('alpha')).toHaveLength(1)

    expect(localStorage.getItem('parallax.document.v2.alpha')).toBeNull()
    expect(localStorage.getItem('parallax.recovery.v1.alpha')).toBeNull()
    expect(localStorage.getItem('parallax.workspace.v1')).toBeNull()
  })

  it('upgrades pre-anchor documents on the way through', async () => {
    const sketchId = 'sketch-1'
    const entityId = 'line-1'
    localStorage.setItem('parallax.document.v2.gamma', JSON.stringify({
      ...legacyDocument('gamma', 'Gamma'),
      features: [{
        id: sketchId,
        kind: 'sketch',
        name: 'Sketch 1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        visible: true,
        plane: 'XY',
        parameters: { planeOffset: 0 },
        entities: [{ id: entityId, type: 'line', start: [0, 0], end: [10, 0], construction: false }],
        constraints: [],
      }],
    }))

    await migrateLegacyStorage()
    const migrated = await readDocument('gamma')

    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    const sketch = migrated?.features[0]
    expect(sketch?.kind === 'sketch' && sketch.anchor).toEqual({ entityId, point: 'start' })
  })

  it('runs only once', async () => {
    localStorage.setItem('parallax.document.v2.delta', JSON.stringify(legacyDocument('delta', 'Delta')))

    expect((await migrateLegacyStorage()).migratedProjects).toBe(1)
    expect((await migrateLegacyStorage()).migratedProjects).toBe(0)
  })

  it('ignores records it cannot recognise instead of failing the whole migration', async () => {
    localStorage.setItem('parallax.document.v2.broken', '{ not json')
    localStorage.setItem('parallax.document.v2.future', JSON.stringify(legacyDocument('future', 'Future', 99)))
    localStorage.setItem('parallax.document.v2.good', JSON.stringify(legacyDocument('good', 'Good')))

    expect((await migrateLegacyStorage()).migratedProjects).toBe(1)
    expect((await readDocument('good'))?.name).toBe('Good')
    expect(await readDocument('future')).toBeNull()
  })
})
