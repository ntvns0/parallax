import { describe, expect, it } from 'vitest'
import {
  bindableField,
  parameterNameIssue,
  parameterUsage,
  renameParameterReferences,
  resolveDocumentFormulas,
  resolveParameterTable,
} from './parameters'
import {
  createEmptyDocument,
  createExtrudeFeature,
  createFeature,
  createFilletFeature,
  createRevolveFeature,
  validateCadDocument,
  type CadDocument,
  type DocumentParameter,
  type Feature,
} from './model'

const parameter = (name: string, expression: string): DocumentParameter => ({ id: `p-${name}`, name, expression })

function documentWith(features: Feature[], parameters: DocumentParameter[] = []): CadDocument {
  return { ...createEmptyDocument(), features, parameters }
}

function sketch() {
  const feature = createFeature('sketch', 1)
  if (feature.kind !== 'sketch') throw new Error('expected a sketch')
  return feature
}

describe('resolveParameterTable', () => {
  it('evaluates parameters that read each other, in any definition order', () => {
    const { scope, entries } = resolveParameterTable([
      parameter('bore', 'plate / 4'),
      parameter('plate', '40'),
    ])
    expect(scope).toEqual({ plate: 40, bore: 10 })
    expect(entries.map((entry) => entry.value)).toEqual([10, 40])
  })

  it('names the whole cycle when a parameter depends on itself', () => {
    const { entries, scope } = resolveParameterTable([
      parameter('a', 'b + 1'),
      parameter('b', 'a + 1'),
    ])
    expect(scope).toEqual({})
    expect(entries[0].error).toMatch(/depends on itself: a → b → a/)
    expect(entries[1].error).toMatch(/depends on itself/)
  })

  it('catches a parameter that refers directly to itself', () => {
    const { entries } = resolveParameterTable([parameter('a', 'a * 2')])
    expect(entries[0].value).toBeNull()
    expect(entries[0].error).toMatch(/depends on itself/)
  })

  it('keeps a failure local instead of emptying the scope', () => {
    const { scope, entries } = resolveParameterTable([
      parameter('good', '12'),
      parameter('bad', 'missing + 1'),
      parameter('downstream', 'bad * 2'),
    ])
    expect(scope.good).toBe(12)
    expect(entries[1].error).toMatch(/no parameter named "missing"/)
    // `downstream` fails too, but because its own dependency is unavailable —
    // and `good` is untouched, which is the property that matters.
    expect(entries[2].value).toBeNull()
  })

  it('reports a duplicated name on every definition and lets the first own the value', () => {
    const { scope, entries } = resolveParameterTable([
      { id: 'a', name: 'width', expression: '10' },
      { id: 'b', name: 'width', expression: '20' },
    ])
    expect(entries[0].error).toMatch(/More than one parameter is named "width"/)
    expect(entries[1].error).toMatch(/More than one parameter is named "width"/)
    expect(scope.width).toBeUndefined()
  })
})

describe('parameterNameIssue', () => {
  const existing = [parameter('width', '10')]
  it('accepts a fresh identifier and rejects the ways a name can be wrong', () => {
    expect(parameterNameIssue('height', existing)).toBeNull()
    expect(parameterNameIssue('width', existing)).toMatch(/already a parameter named/)
    expect(parameterNameIssue('width', existing, 'p-width')).toBeNull()
    expect(parameterNameIssue('pi', existing)).toMatch(/built-in name/)
    expect(parameterNameIssue('2wide', existing)).toMatch(/must start with a letter/)
    expect(parameterNameIssue('  ', existing)).toMatch(/Enter a parameter name/)
  })
})

describe('resolveDocumentFormulas', () => {
  it('writes a formula result into the plain number the kernel reads', () => {
    const extrude = { ...createExtrudeFeature('sketch-1', 1, 10), formulas: { distance: 'plate * 2' } }
    const { document, diagnostics } = resolveDocumentFormulas(documentWith([extrude], [parameter('plate', '6')]))
    expect(document.features[0].parameters).toMatchObject({ distance: 12 })
    expect(diagnostics).toEqual([])
  })

  it('returns the same document object when nothing changed', () => {
    const extrude = { ...createExtrudeFeature('sketch-1', 1, 12), formulas: { distance: 'plate * 2' } }
    const input = documentWith([extrude], [parameter('plate', '6')])
    expect(resolveDocumentFormulas(input).document).toBe(input)
  })

  it('leaves a document with no formulas completely alone', () => {
    const input = documentWith([createExtrudeFeature('sketch-1', 1, 12)])
    expect(resolveDocumentFormulas(input).document).toBe(input)
  })

  it('keeps the last good value and warns when a formula stops evaluating', () => {
    const extrude = { ...createExtrudeFeature('sketch-1', 1, 12), formulas: { distance: 'deleted_parameter' } }
    const { document, diagnostics } = resolveDocumentFormulas(documentWith([extrude]))
    expect(document.features[0].parameters).toMatchObject({ distance: 12 })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe('invalid-formula')
    expect(diagnostics[0].severity).toBe('warning')
    expect(diagnostics[0].message).toMatch(/no parameter named "deleted_parameter"/)
    expect(diagnostics[0].message).toMatch(/12, is still in use/)
    expect(diagnostics[0].repairs[0]).toMatchObject({ kind: 'clear-formula', featureId: extrude.id, key: 'distance' })
  })

  it('refuses a value the document model would reject, rather than writing an invalid part', () => {
    const fillet = { ...createFilletFeature([], 1, 3), formulas: { radius: '0' } }
    const revolve = { ...createRevolveFeature('sketch-1', 1, 90), formulas: { angle: '400' } }
    const { document, diagnostics } = resolveDocumentFormulas(documentWith([fillet, revolve]))
    expect(document.features[0].parameters).toMatchObject({ radius: 3 })
    expect(document.features[1].parameters).toMatchObject({ angle: 90 })
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      expect.stringMatching(/fillet radius must be greater than zero/),
      expect.stringMatching(/no more than 360/),
    ])
  })

  it('keeps a formula off a field that is not a measurement', () => {
    // `axis` is 'X' or 'Y' and `symmetric` is a flag; neither is bindable, so a
    // formula naming them is ignored rather than overwriting them with a number.
    expect(bindableField('revolve', 'axis')).toBeUndefined()
    expect(bindableField('extrude', 'symmetric')).toBeUndefined()
    const revolve = { ...createRevolveFeature('sketch-1', 1, 90), formulas: { axis: '1' } }
    const { document } = resolveDocumentFormulas(documentWith([revolve]))
    expect(document.features[0].parameters).toMatchObject({ axis: 'Y' })
  })

  it('drives an extrusion magnitude without reversing a pocket into a boss', () => {
    const pocket = { ...createExtrudeFeature('sketch-1', 1, -8), formulas: { distance: 'depth' } }
    const { document } = resolveDocumentFormulas(documentWith([pocket], [parameter('depth', '5')]))
    expect(document.features[0].parameters).toMatchObject({ distance: -5 })
  })

  it('drives a sketch dimension through its constraint value', () => {
    const source = sketch()
    source.constraints = [{ id: 'c1', type: 'distance', entityIds: ['e1'], value: 10, formula: 'span / 2' }]
    const { document } = resolveDocumentFormulas(documentWith([source], [parameter('span', '90')]))
    const resolved = document.features[0]
    expect(resolved.kind === 'sketch' && resolved.constraints[0].value).toBe(45)
  })

  it('produces a document that still validates', () => {
    const extrude = { ...createExtrudeFeature('sketch-1', 1, 10), formulas: { distance: 'plate * 2' } }
    const source = sketch()
    const document = resolveDocumentFormulas(
      documentWith([source, { ...extrude, sketchId: source.id }], [parameter('plate', '6')]),
    ).document
    expect(validateCadDocument(document)).toEqual({ valid: true, errors: [] })
  })
})

describe('renameParameterReferences', () => {
  it('rewrites the definition and every formula that reads it', () => {
    const source = sketch()
    source.constraints = [{ id: 'c1', type: 'radius', entityIds: ['e1'], value: 5, formula: 'bore / 2' }]
    const extrude = { ...createExtrudeFeature(source.id, 1, 10), formulas: { distance: 'bore + 2' } }
    const document = documentWith([source, extrude], [parameter('bore', '12'), parameter('clearance', 'bore * 0.1')])

    const renamed = renameParameterReferences(document, 'bore', 'bore_diameter')

    expect(renamed.parameters?.map((entry) => [entry.name, entry.expression])).toEqual([
      ['bore_diameter', '12'],
      ['clearance', 'bore_diameter * 0.1'],
    ])
    expect(renamed.features[1].formulas).toEqual({ distance: 'bore_diameter + 2' })
    const target = renamed.features[0]
    expect(target.kind === 'sketch' && target.constraints[0].formula).toBe('bore_diameter / 2')
  })

  it('does not rewrite a name that is only part of a longer identifier', () => {
    const document = documentWith([], [parameter('bore', '4'), parameter('other', 'bore_depth + bore + xbore')])
    const renamed = renameParameterReferences(document, 'bore', 'hole')
    expect(renamed.parameters?.[1].expression).toBe('bore_depth + hole + xbore')
  })
})

describe('parameterUsage', () => {
  it('lists the features and dimensions that read a parameter', () => {
    const source = sketch()
    source.constraints = [{ id: 'c1', type: 'radius', entityIds: ['e1'], value: 5, formula: 'bore / 2' }]
    const extrude = { ...createExtrudeFeature(source.id, 1, 10), name: 'Extrude 1', formulas: { distance: 'bore + 2' } }
    const document = documentWith([source, extrude], [parameter('bore', '12')])
    // Document order, so the list reads down the feature tree.
    expect(parameterUsage(document, 'bore')).toEqual([
      { featureId: source.id, featureName: source.name, label: 'radius dimension' },
      { featureId: extrude.id, featureName: 'Extrude 1', label: 'Distance' },
    ])
    expect(parameterUsage(document, 'unused')).toEqual([])
  })
})
