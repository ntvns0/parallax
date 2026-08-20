import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { ParametersSection } from './ParametersPanel'
import { PropertiesPanel } from './PropertyPanel'
import { useDocumentStore } from '../core/document-store'

/**
 * These cover the seam between what the user types and what the document holds:
 * `=` in a dimension field, and the parameter table's own editing. The maths is
 * tested in core/expression and core/parameters; what matters here is that the
 * typed text arrives there and the resulting value comes back.
 */

afterEach(cleanup)

function resetDocument() {
  useDocumentStore.setState({
    document: { ...useDocumentStore.getState().document, parameters: [], features: [] },
    selectedId: null,
    formulaDiagnostics: {},
    past: [],
    future: [],
  })
}

describe('the parameters panel', () => {
  beforeEach(resetDocument)

  it('adds a parameter and shows the value its formula produces', () => {
    render(React.createElement(ParametersSection))
    fireEvent.click(screen.getByRole('button', { name: /PARAMETERS/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add parameter/ }))

    const name = screen.getByLabelText(/name$/)
    fireEvent.change(name, { target: { value: 'plate' } })
    fireEvent.blur(name)
    const formula = screen.getByLabelText(/formula$/)
    fireEvent.change(formula, { target: { value: '12 * 3' } })
    fireEvent.blur(formula)

    expect(useDocumentStore.getState().document.parameters).toMatchObject([{ name: 'plate', expression: '12 * 3' }])
    expect(screen.getByText('36')).toBeDefined()
  })

  it('refuses a duplicate name and says why, without changing the document', () => {
    useDocumentStore.getState().addParameter({ name: 'plate', expression: '10' })
    useDocumentStore.getState().addParameter({ name: 'other', expression: '2' })
    render(React.createElement(ParametersSection))
    fireEvent.click(screen.getByRole('button', { name: /PARAMETERS/ }))

    const name = screen.getByLabelText('Parameter other name')
    fireEvent.change(name, { target: { value: 'plate' } })
    fireEvent.blur(name)

    expect(screen.getByText(/already a parameter named "plate"/)).toBeDefined()
    expect(useDocumentStore.getState().document.parameters?.[1].name).toBe('other')
  })

  it('reports a formula that cannot be evaluated on the row that holds it', () => {
    useDocumentStore.getState().addParameter({ name: 'plate', expression: 'nope * 2' })
    render(React.createElement(ParametersSection))
    fireEvent.click(screen.getByRole('button', { name: /PARAMETERS/ }))
    expect(screen.getByText(/no parameter named "nope"/)).toBeDefined()
  })
})

describe('driving a dimension from a field', () => {
  beforeEach(resetDocument)

  function selectedBox() {
    useDocumentStore.getState().addFeature('box')
    const box = useDocumentStore.getState().document.features[0]
    useDocumentStore.getState().select(box.id)
    return box
  }

  it('binds a formula typed with a leading =, and shows the value it evaluates to', () => {
    useDocumentStore.getState().addParameter({ name: 'plate', expression: '15' })
    const box = selectedBox()
    render(React.createElement(PropertiesPanel, { feature: useDocumentStore.getState().document.features[0], onReselectFilletEdges: () => {} }))

    const width = screen.getByLabelText('Width')
    fireEvent.change(width, { target: { value: '=plate * 2' } })
    fireEvent.blur(width)

    const updated = useDocumentStore.getState().document.features.find((feature) => feature.id === box.id)!
    expect(updated.formulas).toEqual({ width: 'plate * 2' })
    expect(updated.parameters).toMatchObject({ width: 30 })
  })

  it('rejects a formula that names nothing, leaving the dimension as it was', () => {
    const box = selectedBox()
    render(React.createElement(PropertiesPanel, { feature: useDocumentStore.getState().document.features[0], onReselectFilletEdges: () => {} }))

    const width = screen.getByLabelText('Width')
    fireEvent.change(width, { target: { value: '=missing / 2' } })
    fireEvent.blur(width)

    expect(screen.getByText(/no parameter named "missing"/)).toBeDefined()
    const updated = useDocumentStore.getState().document.features.find((feature) => feature.id === box.id)!
    expect(updated.formulas).toBeUndefined()
    expect(updated.parameters).toMatchObject({ width: 40 })
  })

  it('offers to clear a formula that has stopped evaluating, keeping the last value', () => {
    const parameterId = useDocumentStore.getState().addParameter({ name: 'plate', expression: '15' })
    const box = selectedBox()
    useDocumentStore.getState().setFeatureFormula(box.id, 'width', 'plate * 2')
    useDocumentStore.getState().removeParameter(parameterId)

    render(React.createElement(PropertiesPanel, { feature: useDocumentStore.getState().document.features[0], onReselectFilletEdges: () => {} }))
    expect(screen.getByText(/no parameter named "plate"/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Remove the formula, keep the value/ }))

    const updated = useDocumentStore.getState().document.features.find((feature) => feature.id === box.id)!
    expect(updated.formulas).toBeUndefined()
    expect(updated.parameters).toMatchObject({ width: 30 })
    expect(useDocumentStore.getState().formulaDiagnostics).toEqual({})
  })
})
