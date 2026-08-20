import type { FeatureDiagnostic } from './diagnostics'
import { isValidParameterName, readDependencies, tryEvaluateExpression, type ExpressionScope } from './expression'
import type { CadDocument, DocumentParameter, Feature, FeatureKind, SketchConstraint } from './model'

/**
 * Named parameters, and the formulas that read them.
 *
 * The point of this module is one seam. A formula is stored beside the number it
 * drives — never instead of it — and this module's job is to keep that number
 * equal to what the formula says. Everything downstream (PlaneGCS, the exact
 * kernel, drawings, export, the operation-chain cache) keeps reading the plain
 * numeric field it always read and needs no knowledge that a formula exists.
 *
 * That is what makes the feature cheap to add and, more importantly, safe: a
 * document whose formulas cannot be evaluated — one saved against a parameter
 * that has since been deleted, say — still holds the last good numbers and still
 * builds the part. Formulas degrade to constants rather than to nothing.
 */

/** How a parameter's own formula turned out. */
export type ResolvedParameter = {
  parameter: DocumentParameter
  /** Null when the formula could not be evaluated; `error` says why. */
  value: number | null
  error?: string
}

export type ParameterResolution = {
  /** Name to value, for every parameter that resolved. Feeds formula evaluation. */
  scope: ExpressionScope
  /** One entry per parameter, in document order. */
  entries: ResolvedParameter[]
}

/**
 * Evaluate the parameter table, in dependency order.
 *
 * Parameters may be defined in any order and may read each other, so the table
 * is a small dependency graph rather than a list. A parameter in a cycle, or one
 * that reads a parameter which itself failed, resolves to null with an error
 * naming the cause — the failure stays local instead of emptying the scope and
 * breaking every unrelated formula in the document.
 */
export function resolveParameterTable(parameters: DocumentParameter[]): ParameterResolution {
  const byName = new Map<string, DocumentParameter>()
  const duplicated = new Set<string>()
  for (const parameter of parameters) {
    if (byName.has(parameter.name)) duplicated.add(parameter.name)
    else byName.set(parameter.name, parameter)
  }

  const scope: Record<string, number> = {}
  const failures = new Map<string, string>()
  const state = new Map<string, 'resolving' | 'done'>()

  function resolve(name: string, trail: string[]): void {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'resolving') {
      // Name the whole cycle: "a → b → a" is the only form of this message that
      // tells the user which edge to cut.
      const cycle = [...trail.slice(trail.indexOf(name)), name].join(' → ')
      for (const member of trail.slice(trail.indexOf(name))) {
        failures.set(member, `This formula depends on itself: ${cycle}.`)
        state.set(member, 'done')
      }
      return
    }
    const parameter = byName.get(name)
    if (!parameter) return
    state.set(name, 'resolving')
    for (const dependency of readDependencies(parameter.expression)) resolve(dependency, [...trail, name])
    if (state.get(name) === 'done') return // A cycle claimed it while descending.
    state.set(name, 'done')
    if (duplicated.has(name)) {
      failures.set(name, `More than one parameter is named "${name}".`)
      return
    }
    const result = tryEvaluateExpression(parameter.expression, scope)
    if (result.ok) scope[name] = result.value
    else failures.set(name, result.error)
  }

  for (const parameter of parameters) resolve(parameter.name, [])

  return {
    scope,
    entries: parameters.map((parameter) => {
      const duplicate = duplicated.has(parameter.name)
      const first = byName.get(parameter.name)
      // Only the first definition of a duplicated name can own the value; the
      // later ones are reported so the user can see which to rename.
      if (duplicate && first !== parameter) {
        return { parameter, value: null, error: `More than one parameter is named "${parameter.name}".` }
      }
      const error = failures.get(parameter.name)
      if (error) return { parameter, value: null, error }
      const value = scope[parameter.name]
      return value === undefined
        ? { parameter, value: null, error: 'This formula could not be evaluated.' }
        : { parameter, value }
    }),
  }
}

/**
 * Drop the formula from a dimension, keeping its value.
 *
 * Used wherever a number is written directly: the value is now the definition,
 * and leaving the formula behind would mean re-evaluating it over the top of the
 * user's edit on the next resolve.
 */
export function withoutConstraintFormula(constraint: SketchConstraint): SketchConstraint {
  if (!constraint.formula) return constraint
  const next = { ...constraint }
  delete next.formula
  return next
}

/** Why a name cannot be used, or null if it can. */
export function parameterNameIssue(name: string, parameters: DocumentParameter[], parameterId?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a parameter name.'
  if (!isValidParameterName(trimmed)) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)
      ? `"${trimmed}" is a built-in name and cannot be used for a parameter.`
      : 'A name must start with a letter or underscore and contain only letters, digits and underscores.'
  }
  if (parameters.some((parameter) => parameter.name === trimmed && parameter.id !== parameterId)) {
    return `There is already a parameter named "${trimmed}".`
  }
  return null
}

/**
 * A numeric feature field a formula may drive.
 *
 * The whitelist matters for two reasons. It keeps a formula off fields where a
 * number is not a measurement — a revolve `axis` is 'X' or 'Y', `symmetric` is a
 * flag — and it carries each field's own validity rule, so a formula that
 * evaluates to something the document model rejects is reported and skipped
 * rather than written and later failing `validateCadDocument`, which is how an
 * autosave or an export would start refusing a project.
 */
export type BindableField = {
  key: string
  label: string
  /** Why this value cannot be used, or null. */
  validate: (value: number) => string | null
  /**
   * True where the sign is owned by a separate control rather than by the
   * number. An extrusion's direction is a checkbox — and, on a face, the same
   * setting as its boolean operation — so a formula supplies the magnitude and
   * the stored direction is preserved.
   */
  magnitudeOnly?: boolean
}

const positive = (label: string) => (value: number) => (value > 0 ? null : `${label} must be greater than zero.`)

const BINDABLE_FIELDS: Record<FeatureKind, BindableField[]> = {
  box: [
    { key: 'width', label: 'Width', validate: positive('Width') },
    { key: 'depth', label: 'Depth', validate: positive('Depth') },
    { key: 'height', label: 'Height', validate: positive('Height') },
  ],
  cylinder: [
    { key: 'radius', label: 'Radius', validate: positive('Radius') },
    { key: 'height', label: 'Height', validate: positive('Height') },
  ],
  sphere: [{ key: 'radius', label: 'Radius', validate: positive('Radius') }],
  sketch: [{ key: 'planeOffset', label: 'Plane offset', validate: () => null }],
  extrude: [
    {
      key: 'distance',
      label: 'Distance',
      magnitudeOnly: true,
      validate: (value) => (Math.abs(value) >= 0.001 ? null : 'A distance must be at least 0.001 mm.'),
    },
    { key: 'edgeRadius', label: 'Edge radius', validate: (value) => (value >= 0 ? null : 'An edge radius cannot be negative.') },
  ],
  fillet: [
    { key: 'radius', label: 'Radius', validate: positive('A fillet radius') },
    { key: 'radius2', label: 'Second radius', validate: positive('A fillet radius') },
  ],
  revolve: [
    {
      key: 'angle',
      label: 'Angle',
      validate: (value) => (value > 0 && value <= 360 ? null : 'An angle must be greater than zero and no more than 360°.'),
    },
  ],
}

export function bindableFields(kind: FeatureKind): BindableField[] {
  return BINDABLE_FIELDS[kind] ?? []
}

export function bindableField(kind: FeatureKind, key: string): BindableField | undefined {
  return bindableFields(kind).find((field) => field.key === key)
}

function formulaDiagnostic(
  feature: Feature,
  label: string,
  key: string,
  message: string,
  lastValue: number,
): FeatureDiagnostic {
  return {
    featureId: feature.id,
    featureName: feature.name,
    severity: 'warning',
    code: 'invalid-formula',
    reason: 'invalid',
    subject: { kind: 'parameter', id: key, label },
    message: `${feature.name} · ${label}: ${message} The last value that worked, ${lastValue}, is still in use.`,
    repairs: [{ kind: 'clear-formula', label: 'Remove the formula, keep the value', featureId: feature.id, key }],
  }
}

/**
 * Recompute every formula in the document.
 *
 * Returns the same document object when nothing changed. That identity matters:
 * this runs on every edit, and the store, the autosave subscription and React
 * all decide whether to do work by comparing references.
 */
export function resolveDocumentFormulas(document: CadDocument): { document: CadDocument; diagnostics: FeatureDiagnostic[] } {
  const { scope } = resolveParameterTable(document.parameters ?? [])
  const diagnostics: FeatureDiagnostic[] = []
  let changed = false

  const features = document.features.map((feature) => {
    const formulas = feature.formulas
    let next = feature

    if (formulas && Object.keys(formulas).length) {
      const parameters: Record<string, unknown> = { ...feature.parameters }
      let parametersChanged = false
      for (const [key, expression] of Object.entries(formulas)) {
        const field = bindableField(feature.kind, key)
        const current = parameters[key]
        if (!field || typeof current !== 'number') continue
        const result = tryEvaluateExpression(expression, scope)
        if (!result.ok) {
          diagnostics.push(formulaDiagnostic(feature, field.label, key, result.error, current))
          continue
        }
        const invalid = field.validate(field.magnitudeOnly ? Math.abs(result.value) : result.value)
        if (invalid) {
          diagnostics.push(formulaDiagnostic(feature, field.label, key, invalid, current))
          continue
        }
        const value = field.magnitudeOnly ? Math.abs(result.value) * (current < 0 ? -1 : 1) : result.value
        if (value !== current) {
          parameters[key] = value
          parametersChanged = true
        }
      }
      if (parametersChanged) next = { ...feature, parameters } as Feature
    }

    if (next.kind === 'sketch') {
      let constraintsChanged = false
      const constraints = next.constraints.map((constraint) => {
        if (!constraint.formula || constraint.value === undefined) return constraint
        const result = tryEvaluateExpression(constraint.formula, scope)
        if (!result.ok) {
          diagnostics.push(formulaDiagnostic(next, `${constraint.type} dimension`, constraint.id, result.error, constraint.value))
          return constraint
        }
        if (result.value === constraint.value) return constraint
        constraintsChanged = true
        return { ...constraint, value: result.value }
      })
      if (constraintsChanged) next = { ...next, constraints }
    }

    if (next !== feature) changed = true
    return next
  })

  return { document: changed ? { ...document, features } : document, diagnostics }
}

/**
 * Rename a parameter and rewrite every formula that reads it.
 *
 * A rename that left formulas pointing at the old name would break silently —
 * the numbers would keep their last value and only the diagnostics would say
 * anything — so the rename is a document-wide edit, not a field edit.
 */
export function renameParameterReferences(document: CadDocument, from: string, to: string): CadDocument {
  if (from === to) return document
  const rewrite = (expression: string) => rewriteExpressionName(expression, from, to)
  return {
    ...document,
    parameters: (document.parameters ?? []).map((parameter) => ({
      ...parameter,
      name: parameter.name === from ? to : parameter.name,
      expression: rewrite(parameter.expression),
    })),
    features: document.features.map((feature) => {
      const formulas = feature.formulas
        ? Object.fromEntries(Object.entries(feature.formulas).map(([key, expression]) => [key, rewrite(expression)]))
        : undefined
      const base = formulas ? { ...feature, formulas } : feature
      if (base.kind !== 'sketch') return base
      return {
        ...base,
        constraints: base.constraints.map((constraint) =>
          constraint.formula ? { ...constraint, formula: rewrite(constraint.formula) } : constraint),
      }
    }),
  }
}

/**
 * Replace whole-identifier occurrences of a name in a formula.
 *
 * Word boundaries alone are not enough, because a name can be a suffix of a
 * longer identifier (`bore` inside `bore_depth`) and because a bare `-` is a
 * word boundary in a way `_` is not. This checks the neighbouring characters
 * against the identifier alphabet instead.
 */
function rewriteExpressionName(expression: string, from: string, to: string): string {
  if (!expression.includes(from)) return expression
  const identifier = /[A-Za-z0-9_]/
  let result = ''
  let index = 0
  while (index < expression.length) {
    if (expression.startsWith(from, index)) {
      const before = expression[index - 1]
      const after = expression[index + from.length]
      if (!(before && identifier.test(before)) && !(after && identifier.test(after))) {
        result += to
        index += from.length
        continue
      }
    }
    result += expression[index]
    index += 1
  }
  return result
}

/** Which features read a parameter, for the "used by" line in the parameters panel. */
export function parameterUsage(document: CadDocument, name: string): { featureId: string; featureName: string; label: string }[] {
  const usage: { featureId: string; featureName: string; label: string }[] = []
  for (const feature of document.features) {
    for (const [key, expression] of Object.entries(feature.formulas ?? {})) {
      if (!readDependencies(expression).includes(name)) continue
      usage.push({ featureId: feature.id, featureName: feature.name, label: bindableField(feature.kind, key)?.label ?? key })
    }
    if (feature.kind !== 'sketch') continue
    for (const constraint of feature.constraints) {
      if (!constraint.formula || !readDependencies(constraint.formula).includes(name)) continue
      usage.push({ featureId: feature.id, featureName: feature.name, label: `${constraint.type} dimension` })
    }
  }
  return usage
}
