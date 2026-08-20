import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as storage from './project-storage'

async function freshStore() {
  const { useDocumentStore } = await import('./document-store')
  await useDocumentStore.getState().hydrate()
  return useDocumentStore
}

describe('local project workspace', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('preserves the current part when creating another project', async () => {
    const useDocumentStore = await freshStore()
    const firstId = useDocumentStore.getState().document.id
    useDocumentStore.getState().addFeature('box')
    await useDocumentStore.getState().save()
    await useDocumentStore.getState().newDocument()

    const state = useDocumentStore.getState()
    expect(state.document.id).not.toBe(firstId)
    expect(state.projects).toHaveLength(2)
    const first = await storage.readDocument(firstId)
    expect(first?.features).toHaveLength(1)
    expect(first?.features[0].kind).toBe('box')
  })

  it('keeps recovery snapshots before overwriting a saved project', async () => {
    const useDocumentStore = await freshStore()
    useDocumentStore.getState().addFeature('box')
    await useDocumentStore.getState().save()
    const box = useDocumentStore.getState().document.features[0]
    useDocumentStore.getState().updateParameters(box.id, { width: 72 })
    await useDocumentStore.getState().save()

    const snapshots = useDocumentStore.getState().recoverySnapshots
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots[0].document.features[0].parameters).toMatchObject({ width: 40 })
  })

  it('reopens the project that was active last', async () => {
    const first = await freshStore()
    first.getState().addFeature('cylinder')
    await first.getState().save()
    const activeId = first.getState().document.id

    vi.resetModules()
    const reopened = await freshStore()
    expect(reopened.getState().document.id).toBe(activeId)
    expect(reopened.getState().document.features[0].kind).toBe('cylinder')
  })

  it('does not autosave over a project that is still loading', async () => {
    const { useDocumentStore } = await import('./document-store')
    expect(useDocumentStore.getState().ready).toBe(false)

    // An edit made before hydration finishes must not reach storage.
    useDocumentStore.getState().addFeature('box')
    const emptyId = useDocumentStore.getState().document.id
    await useDocumentStore.getState().save()
    expect(await storage.readDocument(emptyId)).toBeNull()
  })

  it('creates a plane-specific sketch and a linked extrusion', async () => {
    const useDocumentStore = await freshStore()
    useDocumentStore.getState().beginSketch(undefined, 'YZ', 20, 1)
    const sketch = useDocumentStore.getState().document.features[0]
    expect(sketch).toMatchObject({ kind: 'sketch', plane: 'YZ', parameters: { planeOffset: 20, faceNormalSign: 1 } })
    useDocumentStore.getState().extrudeSketch(sketch.id)
    expect(useDocumentStore.getState().document.features[1]).toMatchObject({ kind: 'extrude', sketchId: sketch.id, operation: 'add', parameters: { distance: 25 } })
  })

  it('changes display units without converting internal geometry', async () => {
    const useDocumentStore = await freshStore()
    useDocumentStore.getState().addFeature('box')
    useDocumentStore.getState().setDisplayUnits('in-fractional')

    const state = useDocumentStore.getState()
    expect(state.document.displayUnits).toBe('in-fractional')
    expect(state.document.features[0].parameters).toMatchObject({ width: 40, depth: 40, height: 24 })
  })

  async function faceAttachedExtrude() {
    const useDocumentStore = await freshStore()
    useDocumentStore.getState().beginSketch(undefined, 'XZ', 20, 1)
    const sketch = useDocumentStore.getState().document.features[0]
    useDocumentStore.getState().addSketchGeometry(sketch.id, [{
      id: crypto.randomUUID(),
      type: 'circle',
      center: [0, 0],
      radius: 5,
      construction: false,
    }], [])
    useDocumentStore.getState().extrudeSketch(sketch.id)
    return { useDocumentStore, extrudeId: useDocumentStore.getState().document.features[1].id }
  }

  it('grows a face-attached extrusion outward by default whatever the profile is', async () => {
    // The profile shape used to decide this: a circle became a hole and
    // anything else became a boss, which no user could predict.
    const { useDocumentStore } = await faceAttachedExtrude()

    expect(useDocumentStore.getState().document.features[1]).toMatchObject({
      kind: 'extrude',
      operation: 'add',
      parameters: { distance: 25 },
    })
  })

  it('turns a face-attached extrusion into a cut when it is pushed through the face', async () => {
    const { useDocumentStore, extrudeId } = await faceAttachedExtrude()

    useDocumentStore.getState().updateParameters(extrudeId, { distance: -6 })

    expect(useDocumentStore.getState().document.features[1]).toMatchObject({
      operation: 'cut',
      parameters: { distance: -6 },
    })
  })

  it('turns the extrusion inward when a cut is chosen from the panel', async () => {
    const { useDocumentStore, extrudeId } = await faceAttachedExtrude()

    useDocumentStore.getState().updateFeature(extrudeId, { operation: 'cut' })

    expect(useDocumentStore.getState().document.features[1]).toMatchObject({
      operation: 'cut',
      parameters: { distance: -25 },
    })
  })

  it('leaves a base-plane extrusion free to cut in either direction', async () => {
    // Without a face there is no material to push into, so direction and
    // boolean stay independent.
    const useDocumentStore = await freshStore()
    useDocumentStore.getState().beginSketch(undefined, 'XY')
    const sketch = useDocumentStore.getState().document.features[0]
    useDocumentStore.getState().addSketchGeometry(sketch.id, [{
      id: crypto.randomUUID(), type: 'circle', center: [0, 0], radius: 5, construction: false,
    }], [])
    useDocumentStore.getState().extrudeSketch(sketch.id)
    const extrudeId = useDocumentStore.getState().document.features[1].id

    useDocumentStore.getState().updateFeature(extrudeId, { operation: 'cut' })

    expect(useDocumentStore.getState().document.features[1]).toMatchObject({
      operation: 'cut',
      parameters: { distance: 25 },
    })
  })

  it('anchors the solver to the first geometry drawn and rehomes it on delete', async () => {
    const useDocumentStore = await freshStore()
    useDocumentStore.getState().beginSketch(undefined, 'XY')
    const sketchId = useDocumentStore.getState().document.features[0].id
    const first = { id: crypto.randomUUID(), type: 'circle' as const, center: [0, 0] as [number, number], radius: 4, construction: false }
    const second = { id: crypto.randomUUID(), type: 'circle' as const, center: [30, 0] as [number, number], radius: 4, construction: false }
    useDocumentStore.getState().addSketchGeometry(sketchId, [first, second], [])

    const anchored = useDocumentStore.getState().document.features[0]
    expect(anchored.kind === 'sketch' && anchored.anchor).toEqual({ entityId: first.id, point: 'center' })

    useDocumentStore.getState().deleteSketchEntity(sketchId, first.id)
    const rehomed = useDocumentStore.getState().document.features[0]
    expect(rehomed.kind === 'sketch' && rehomed.anchor).toEqual({ entityId: second.id, point: 'center' })
  })

  it('persists face center and boundary references on a new sketch', async () => {
    const useDocumentStore = await freshStore()
    const attachment = {
      type: 'face' as const,
      featureId: 'extrude-1',
      featureName: 'Extrude 1',
      faceLabel: 'Front face',
      center: [5, 12] as [number, number],
      bounds: { min: [-15, 0] as [number, number], max: [25, 24] as [number, number] },
      edges: [{ start: [-15, 0] as [number, number], end: [25, 0] as [number, number] }],
      area: 960,
    }
    useDocumentStore.getState().beginSketch(undefined, 'XZ', 20, 1, attachment)

    expect(useDocumentStore.getState().document.features[0]).toMatchObject({
      kind: 'sketch',
      attachment,
    })
  })

  it('leaves one undo step for a whole amended gesture', async () => {
    // Dragging a face emits an update per frame. Without amend, undo would have
    // to be pressed once per frame to get back to where the drag started.
    const useDocumentStore = await freshStore()
    useDocumentStore.getState().addFeature('box')
    const id = useDocumentStore.getState().document.features[0].id
    const historyBefore = useDocumentStore.getState().past.length

    useDocumentStore.getState().updateParameters(id, { width: 41 })
    for (const width of [42, 43, 44, 45]) {
      useDocumentStore.getState().updateParameters(id, { width }, { amend: true })
    }

    expect(useDocumentStore.getState().past.length).toBe(historyBefore + 1)
    expect(useDocumentStore.getState().document.features[0].parameters).toMatchObject({ width: 45 })

    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().document.features[0].parameters).toMatchObject({ width: 40 })
  })
})
