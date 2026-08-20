import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useDocumentStore } from '../core/document-store'
import { parameterNameIssue, parameterUsage, resolveParameterTable } from '../core/parameters'
import type { DocumentParameter } from '../core/model'

/**
 * Values are shown as plain numbers rather than through `formatLength`.
 *
 * A parameter has no declared kind — the same table holds a plate thickness and
 * a draft angle — so converting one to inches because the document is displaying
 * inches would be wrong for the angle. Millimeters and degrees are what the
 * formula language reads and writes, so that is what is shown, and the panel
 * says so.
 */
function formatParameterValue(value: number) {
  return String(Math.round(value * 10_000) / 10_000)
}

function ParameterRow({ parameter, value, error }: { parameter: DocumentParameter; value: number | null; error?: string }) {
  const document = useDocumentStore((state) => state.document)
  const [name, setName] = useState(parameter.name)
  const [expression, setExpression] = useState(parameter.expression)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => setName(parameter.name), [parameter.name])
  useEffect(() => setExpression(parameter.expression), [parameter.expression])

  const usage = parameterUsage(document, parameter.name)

  function commitName() {
    const trimmed = name.trim()
    if (trimmed === parameter.name) {
      setNameError(null)
      return
    }
    const issue = parameterNameIssue(trimmed, document.parameters ?? [], parameter.id)
    if (issue) {
      setNameError(issue)
      setName(parameter.name)
      return
    }
    setNameError(null)
    useDocumentStore.getState().updateParameter(parameter.id, { name: trimmed })
  }

  function commitExpression() {
    if (expression === parameter.expression) return
    useDocumentStore.getState().updateParameter(parameter.id, { expression })
  }

  const message = nameError ?? error

  return (
    <div className={`parameter-row${message ? ' invalid' : ''}`}>
      <input
        aria-label={`Parameter ${parameter.name} name`}
        className="parameter-name"
        value={name}
        onChange={(event) => { setName(event.target.value); setNameError(null) }}
        onBlur={commitName}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
      <input
        aria-label={`Parameter ${parameter.name} formula`}
        className="parameter-expression"
        value={expression}
        onChange={(event) => setExpression(event.target.value)}
        onBlur={commitExpression}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
      <span
        className="parameter-value"
        title={usage.length
          ? `Used by ${usage.map((entry) => `${entry.featureName} · ${entry.label}`).join(', ')}`
          : 'Not used by any feature yet'}
      >
        {value === null ? '—' : formatParameterValue(value)}
        {usage.length > 0 && <em>{usage.length}</em>}
      </span>
      <button
        aria-label={`Delete parameter ${parameter.name}`}
        title={usage.length ? `${usage.length} dimension${usage.length === 1 ? '' : 's'} will keep their current value and report a broken formula.` : 'Delete this parameter'}
        onClick={() => useDocumentStore.getState().removeParameter(parameter.id)}
      >
        <Trash2 size={12} />
      </button>
      {message && <p className="parameter-error">{message}</p>}
    </div>
  )
}

/**
 * The named parameter table, at the foot of the feature tree.
 *
 * It sits beside the feature tree rather than in the properties panel because it
 * belongs to the document, not to whichever feature happens to be selected —
 * and because a formula is usually typed while looking at the parameter it reads.
 */
export function ParametersSection() {
  const parameters = useDocumentStore((state) => state.document.parameters) ?? []
  const [open, setOpen] = useState(false)
  const { entries } = resolveParameterTable(parameters)
  const broken = entries.filter((entry) => entry.error).length

  return (
    <section className={`parameters-section${open ? ' open' : ''}`}>
      <button className="parameters-header" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>PARAMETERS</span>
        {parameters.length > 0 && <em className={broken ? 'invalid' : ''}>{broken ? `${broken} broken` : parameters.length}</em>}
      </button>
      {open && (
        <div className="parameters-body">
          {parameters.length === 0 && (
            <p className="parameters-empty">
              Name a value here, then drive any dimension by it: type <code>=name * 2</code> into a dimension field.
            </p>
          )}
          {entries.map((entry) => (
            <ParameterRow key={entry.parameter.id} parameter={entry.parameter} value={entry.value} error={entry.error} />
          ))}
          <button className="parameters-add" onClick={() => useDocumentStore.getState().addParameter()}>
            <Plus size={12} /> Add parameter
          </button>
          {parameters.length > 0 && <p className="parameters-note">Values are millimeters and degrees. Write <code>1in</code> for an inch.</p>}
        </div>
      )}
    </section>
  )
}
