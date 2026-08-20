import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { isDimensionConstraint, type DisplayUnits, type SketchConstraint, type SketchFeature } from '../core/model'
import { formatLengthInput, parseLengthInput, unitLabel } from '../core/units'
import { CONSTRAINT_LABELS, availableConstraints, buildConstraint, describeConstraint } from './constraint-authoring'
import { applySketchConstraint, applySketchConstraintFormula, applySketchConstraintValue, removeSketchConstraint } from './sketch-edits'

/**
 * The sketch's constraints, as something a user can read and change.
 *
 * Constraints used to be created silently as geometry was drawn and could only
 * be removed by deleting the geometry that carried them. Listing them makes the
 * design intent in a sketch visible, and makes every dimension editable rather
 * than only the two the overall-size heuristic happens to recognise.
 */
export function ConstraintPanel({ sketch, selectedEntityIds, conflicting, redundant, unsupported, displayUnits, onHighlight }: {
  sketch: SketchFeature
  selectedEntityIds: string[]
  conflicting: string[]
  redundant: string[]
  unsupported: string[]
  displayUnits: DisplayUnits
  onHighlight: (entityIds: string[]) => void
}) {
  const options = availableConstraints(sketch.entities, selectedEntityIds)
  // Ordered least to most serious: a constraint that never reached the solver
  // is a worse problem than one it merely did not need.
  const troubled = new Map<string, ConstraintTrouble>([
    ...redundant.map((id) => [id, 'redundant'] as const),
    ...conflicting.map((id) => [id, 'conflicting'] as const),
    ...unsupported.map((id) => [id, 'not applied'] as const),
  ])

  function add(type: Parameters<typeof buildConstraint>[0]) {
    const constraint = buildConstraint(type, sketch.entities, selectedEntityIds)
    if (constraint) void applySketchConstraint(sketch.id, constraint)
  }

  return (
    <div className="constraint-panel">
      <div className="constraint-panel-heading">
        <span>CONSTRAINTS</span>
        <small>{sketch.constraints.length}</small>
      </div>

      {options.length > 0 && (
        <div className="constraint-add">
          {options.map((option) => (
            <button key={`${option.type}-${option.label}`} title={option.hint} onClick={() => add(option.type)}>
              {option.label}
            </button>
          ))}
        </div>
      )}
      {options.length === 0 && (
        <p className="constraint-hint">
          {selectedEntityIds.length === 0
            ? 'Select geometry to add a constraint. Shift-click to select a second entity.'
            : selectedEntityIds.length > 2
              ? 'Select one or two entities.'
              : 'No constraint applies to this selection.'}
        </p>
      )}

      {sketch.constraints.length === 0
        ? <p className="constraint-hint">This sketch has no constraints yet.</p>
        : (
          <ul className="constraint-list">
            {sketch.constraints.map((constraint) => (
              <ConstraintRow
                key={constraint.id}
                sketchId={sketch.id}
                constraint={constraint}
                detail={describeConstraint(constraint, sketch.entities)}
                trouble={troubled.get(constraint.id)}
                displayUnits={displayUnits}
                onHighlight={onHighlight}
              />
            ))}
          </ul>
        )}
    </div>
  )
}

type ConstraintTrouble = 'conflicting' | 'redundant' | 'not applied'

function ConstraintRow({ sketchId, constraint, detail, trouble, displayUnits, onHighlight }: {
  sketchId: string
  constraint: SketchConstraint
  detail: string
  trouble: ConstraintTrouble | undefined
  displayUnits: DisplayUnits
  onHighlight: (entityIds: string[]) => void
}) {
  const editable = isDimensionConstraint(constraint) && typeof constraint.value === 'number'
  // An angle is in degrees and is not a length, so it never goes through the
  // unit formatter.
  const isAngle = constraint.type === 'angle'
  const format = (value: number) => isAngle ? `${value.toFixed(2)}` : formatLengthInput(value, displayUnits)
  // A driven dimension shows its formula rather than the number, so the sketch
  // says what it means: `=bore/2` is the intent, 6 is only today's answer.
  const settled = () => constraint.formula ? `=${constraint.formula}` : editable ? format(constraint.value!) : ''
  const [draft, setDraft] = useState(settled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(settled())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraint.value, constraint.formula, displayUnits, editable])

  function commit() {
    if (!editable) return
    if (draft.trim().startsWith('=')) {
      void applySketchConstraintFormula(sketchId, constraint.id, draft.trim().slice(1).trim()).then((failure) => setError(failure ?? null))
      return
    }
    setError(null)
    const parsed = isAngle ? Number(draft) : parseLengthInput(draft, displayUnits)
    if (parsed === null || !Number.isFinite(parsed)) {
      setDraft(settled())
      return
    }
    if (!constraint.formula && Math.abs(parsed - constraint.value!) < 1e-9) return
    void applySketchConstraintValue(sketchId, constraint.id, parsed)
  }

  return (
    <li
      className={`constraint-row ${trouble?.replace(' ', '-') ?? ''}`}
      onMouseEnter={() => onHighlight(constraint.entityIds)}
      onMouseLeave={() => onHighlight([])}
    >
      <div className="constraint-identity">
        <strong>{CONSTRAINT_LABELS[constraint.type]}</strong>
        <small>{detail}</small>
        {trouble && <em>{trouble}</em>}
      </div>
      {editable && (
        <label className={`constraint-value${constraint.formula ? ' driven' : ''}`}>
          <input
            aria-label={`${CONSTRAINT_LABELS[constraint.type]} value`}
            title={error ?? (constraint.formula ? `Driven by ${constraint.formula} = ${format(constraint.value!)}` : undefined)}
            aria-invalid={Boolean(error)}
            className={error ? 'invalid' : ''}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setError(null) }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setDraft(settled())
                setError(null)
                event.currentTarget.blur()
              }
            }}
          />
          <em>{constraint.formula ? 'fx' : isAngle ? '°' : unitLabel(displayUnits)}</em>
        </label>
      )}
      <button
        className="constraint-remove"
        aria-label={`Remove ${CONSTRAINT_LABELS[constraint.type]} constraint`}
        title="Remove this constraint"
        onClick={() => void removeSketchConstraint(sketchId, constraint.id)}
      ><Trash2 /></button>
    </li>
  )
}
