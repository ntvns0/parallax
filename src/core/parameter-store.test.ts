import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshStore() {
  const { useDocumentStore } = await import('./document-store')
  await useDocumentStore.getState().hydrate()
  return useDocumentStore
}

describe('named parameters in the editor store', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('drives a feature dimension from a parameter, and follows it when the parameter changes', async () => {
    const store = await freshStore()
    store.getState().addFeature('box')
    const box = store.getState().document.features[0]
    const parameterId = store.getState().addParameter({ name: 'plate', expression: '30' })

    store.getState().setFeatureFormula(box.id, 'width', 'plate * 2')
    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 60 })

    store.getState().updateParameter(parameterId, { expression: '25' })
    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 50 })
  })

  it('undoes a parameter change as a single step, restoring what it drove', async () => {
    const store = await freshStore()
    store.getState().addFeature('box')
    const box = store.getState().document.features[0]
    const parameterId = store.getState().addParameter({ name: 'plate', expression: '30' })
    store.getState().setFeatureFormula(box.id, 'width', 'plate')
    store.getState().updateParameter(parameterId, { expression: '80' })
    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 80 })

    store.getState().undo()
    expect(store.getState().document.parameters?.[0].expression).toBe('30')
    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 30 })
  })

  it('rewrites formulas when a parameter is renamed, in the same undo step', async () => {
    const store = await freshStore()
    store.getState().addFeature('cylinder')
    const cylinder = store.getState().document.features[0]
    const parameterId = store.getState().addParameter({ name: 'bore', expression: '12' })
    store.getState().setFeatureFormula(cylinder.id, 'radius', 'bore / 2')

    store.getState().updateParameter(parameterId, { name: 'bore_diameter' })

    expect(store.getState().document.features[0].formulas).toEqual({ radius: 'bore_diameter / 2' })
    expect(store.getState().document.features[0].parameters).toMatchObject({ radius: 6 })
    expect(store.getState().formulaDiagnostics).toEqual({})

    store.getState().undo()
    expect(store.getState().document.features[0].formulas).toEqual({ radius: 'bore / 2' })
  })

  it('keeps the last value and reports the feature when a parameter is deleted', async () => {
    const store = await freshStore()
    store.getState().addFeature('box')
    const box = store.getState().document.features[0]
    const parameterId = store.getState().addParameter({ name: 'plate', expression: '30' })
    store.getState().setFeatureFormula(box.id, 'width', 'plate')

    store.getState().removeParameter(parameterId)

    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 30 })
    const diagnostic = store.getState().formulaDiagnostics[box.id]
    expect(diagnostic.code).toBe('invalid-formula')
    expect(diagnostic.message).toMatch(/no parameter named "plate"/)
    // The formula is left as written, so restoring the parameter repairs it.
    expect(store.getState().document.features[0].formulas).toEqual({ width: 'plate' })
    store.getState().addParameter({ name: 'plate', expression: '44' })
    expect(store.getState().formulaDiagnostics).toEqual({})
    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 44 })
  })

  it('lets a typed number replace the formula that used to drive the field', async () => {
    const store = await freshStore()
    store.getState().addFeature('box')
    const box = store.getState().document.features[0]
    store.getState().addParameter({ name: 'plate', expression: '30' })
    store.getState().setFeatureFormula(box.id, 'width', 'plate')

    store.getState().updateParameters(box.id, { width: 17 })

    expect(store.getState().document.features[0].formulas).toBeUndefined()
    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 17 })
  })

  it('leaves other formulas on the feature alone when one field is typed over', async () => {
    const store = await freshStore()
    store.getState().addFeature('box')
    const box = store.getState().document.features[0]
    store.getState().addParameter({ name: 'plate', expression: '30' })
    store.getState().setFeatureFormula(box.id, 'width', 'plate')
    store.getState().setFeatureFormula(box.id, 'height', 'plate / 3')

    store.getState().updateParameters(box.id, { width: 17 })

    expect(store.getState().document.features[0].formulas).toEqual({ height: 'plate / 3' })
    expect(store.getState().document.features[0].parameters).toMatchObject({ width: 17, height: 10 })
  })

  it('gives a new parameter a name that is free', async () => {
    const store = await freshStore()
    store.getState().addParameter()
    store.getState().addParameter()
    const names = store.getState().document.parameters?.map((parameter) => parameter.name)
    expect(new Set(names).size).toBe(2)
  })

  it('survives a reload with the formula and the value it produced', async () => {
    const store = await freshStore()
    store.getState().addFeature('box')
    const box = store.getState().document.features[0]
    store.getState().addParameter({ name: 'plate', expression: '18' })
    store.getState().setFeatureFormula(box.id, 'width', 'plate * 2')
    await store.getState().save()

    vi.resetModules()
    const reopened = await freshStore()
    const feature = reopened.getState().document.features[0]
    expect(feature.formulas).toEqual({ width: 'plate * 2' })
    expect(feature.parameters).toMatchObject({ width: 36 })
    expect(reopened.getState().document.parameters?.[0]).toMatchObject({ name: 'plate', expression: '18' })
  })
})
