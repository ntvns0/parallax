import { useEffect, useState } from 'react'
import { Download, MousePointer2, Trash2 } from 'lucide-react'
import { useDocumentStore } from '../core/document-store'
import { collectDocumentDiagnostics, collectOpenProfileDiagnostics, collectRevolveAxisDiagnostics, findDiagnosticRepair, useFeatureDiagnosticsStore } from '../core/diagnostics'
import type { Feature, FilletCornerStyle, FilletProfileShape, HoleFeature, HoleForm, HoleParameters, SketchFeature, Vec3 } from '../core/model'
import { applyHolePreset, holeCallout, holePlacements, holeProblem, HOLE_PRESETS } from '../core/hole'
import { revolveAxisCandidates } from '../core/revolve-axis'
import { getProfileRegions, sketchBounds } from '../core/sketch'
import { formatLength, formatLengthInput, parseLengthInput, unitLabel } from '../core/units'
import { tryEvaluateExpression } from '../core/expression'
import { resolveParameterTable } from '../core/parameters'
import { isFaceAttached } from '../core/extrude-direction'
import { exportExactStep, exportExactStl } from '../kernel/exact-kernel'
import { applySketchResize } from '../sketcher/sketch-edits'
import { ExtrudeFeatureIcon, FeatureIcon, RevolveFeatureIcon, SketchFeatureIcon } from './icons'

/** The evaluated parameter table, for checking a formula as it is typed. */
function useParameterScope() {
  const parameters = useDocumentStore((state) => state.document.parameters)
  return resolveParameterTable(parameters ?? []).scope
}

/**
 * A dimension field that accepts either a number or a formula.
 *
 * A leading `=` is what distinguishes the two, as it does in a spreadsheet. The
 * field is the only place the two forms meet, so the rule lives here: `=` binds
 * the field to a formula, and anything else is a literal that clears the binding
 * — the store drops the formula whenever a parameter is written directly, so
 * typing over a driven dimension does what it looks like it does.
 *
 * Passing `binding` is what makes a field formula-capable. Fields that are not
 * feature parameters — the sketch resize boxes, which run a solver edit rather
 * than set a value — leave it out and keep the old behaviour.
 */
function NumberField({ label, value, minAbs, onCommit, binding, formula }: {
  label: string
  value: number
  minAbs?: number
  onCommit: (value: number) => void
  binding?: { featureId: string; key: string }
  formula?: string
}) {
  const displayUnits = useDocumentStore((state) => state.document.displayUnits ?? 'mm')
  const scope = useParameterScope()
  const settled = formula ? `=${formula}` : formatLengthInput(value, displayUnits)
  const [draft, setDraft] = useState(settled)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setDraft(settled), [settled])

  function commit() {
    if (draft === settled) {
      setError(null)
      return
    }
    if (binding && draft.trim().startsWith('=')) {
      const expression = draft.trim().slice(1).trim()
      const result = tryEvaluateExpression(expression, scope)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (minAbs !== undefined && Math.abs(result.value) < minAbs) {
        setError(`That formula gives ${formatLength(result.value, displayUnits)}; the magnitude must be at least ${formatLength(minAbs, displayUnits)}.`)
        return
      }
      setError(null)
      useDocumentStore.getState().setFeatureFormula(binding.featureId, binding.key, expression)
      return
    }
    const parsed = parseLengthInput(draft, displayUnits)
    if (parsed === null) {
      setError(displayUnits === 'in-fractional' ? 'Enter a decimal, a fraction such as 1 5/16, or a formula such as =width/2.' : 'Enter a number, or a formula such as =width/2.')
      setDraft(settled)
    } else if (minAbs !== undefined && Math.abs(parsed) < minAbs) {
      setError(`Enter a value whose magnitude is at least ${formatLength(minAbs, displayUnits)}.`)
      setDraft(settled)
    } else {
      setError(null)
      onCommit(parsed)
    }
  }

  return (
    <label className={`number-field${formula ? ' driven' : ''}`}>
      <span>{label}</span>
      <div>
        <input
          // Named explicitly: the label element also holds the unit suffix, so
          // its text content alone would announce as "Widthmm".
          aria-label={label}
          className={error ? 'invalid' : ''}
          title={error ?? (formula ? `Driven by ${formula} = ${formatLength(value, displayUnits)}` : undefined)}
          aria-invalid={Boolean(error)}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setError(null) }}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
        <em>{formula ? 'fx' : unitLabel(displayUnits)}</em>
      </div>
      {error && <p className="field-error">{error}</p>}
      {!error && formula && <p className="field-driven">= {formatLength(value, displayUnits)}</p>}
    </label>
  )
}

function PropertyIdentity({ feature }: { feature: Feature }) {
  return (
    <>
      <div className="property-section identity-section">
        <div className="feature-badge"><FeatureIcon feature={feature} /></div>
        <div><span>{feature.kind.toUpperCase()} FEATURE</span><input value={feature.name} onChange={(event) => useDocumentStore.getState().updateFeature(feature.id, { name: event.target.value })} /></div>
      </div>
      <FormulaWarning feature={feature} />
    </>
  )
}

/** A sweep the operation chain is skipping because its sketch came apart. */
function OpenProfileWarning({ feature }: { feature: Feature }) {
  const features = useDocumentStore((state) => state.document.features)
  const diagnostic = collectOpenProfileDiagnostics(features)[feature.id]
  const repair = diagnostic && findDiagnosticRepair(diagnostic, 'edit-sketch')
  if (!diagnostic) return null
  return (
    <div className="dependency-warning">
      <span>{diagnostic.message}</span>
      {repair && (
        <button type="button" onClick={() => useDocumentStore.getState().beginSketch(repair.sketchId)}>
          {repair.label}
        </button>
      )}
    </div>
  )
}

/**
 * A formula on this feature that no longer evaluates.
 *
 * Shown on every feature panel, because a formula can break without the user
 * touching the feature that holds it — deleting the parameter it reads is enough.
 */
function FormulaWarning({ feature }: { feature: Feature }) {
  const diagnostic = useDocumentStore((state) => state.formulaDiagnostics[feature.id])
  const repair = diagnostic && findDiagnosticRepair(diagnostic, 'clear-formula')
  if (!diagnostic) return null
  return (
    <div className="dependency-warning">
      <span>{diagnostic.message}</span>
      {repair && (
        <button type="button" onClick={() => useDocumentStore.getState().setFeatureFormula(repair.featureId, repair.key, null)}>
          {repair.label}
        </button>
      )}
    </div>
  )
}

function PrimitiveProperties({ feature }: { feature: Extract<Feature, { kind: 'box' | 'cylinder' | 'sphere' }> }) {
  const updateParameters = useDocumentStore((state) => state.updateParameters)
  const updateFeature = useDocumentStore((state) => state.updateFeature)
  const parameters = Object.entries(feature.parameters)
  const labels: Record<string, string> = { width: 'Width', depth: 'Depth', height: 'Height', radius: 'Radius' }
  const axisLabels = ['X', 'Y', 'Z']
  return (
    <aside className="panel properties-panel">
      <div className="panel-header"><span>PROPERTIES</span><button aria-label="Close properties" onClick={() => useDocumentStore.getState().select(null)}>×</button></div>
      <PropertyIdentity feature={feature} />
      <div className="property-section">
        <h3>Dimensions</h3>
        {parameters.map(([key, value]) => (
          <NumberField
            key={key}
            label={labels[key] ?? key}
            value={value}
            binding={{ featureId: feature.id, key }}
            formula={feature.formulas?.[key]}
            onCommit={(next) => updateParameters(feature.id, { [key]: Math.max(0.001, next) })}
          />
        ))}
      </div>
      <div className="property-section">
        <h3>Position</h3>
        {feature.position.map((value, index) => (
          <NumberField
            key={axisLabels[index]}
            label={axisLabels[index]}
            value={value}
            onCommit={(next) => {
              const position = [...feature.position] as Vec3
              position[index] = next
              updateFeature(feature.id, { position })
            }}
          />
        ))}
      </div>
      <div className="property-section feature-info">
        <span>Feature ID</span><code>{feature.id.slice(0, 8)}</code>
        <span>Evaluator</span><strong>Preview mesh</strong>
      </div>
      <button className="delete-feature" onClick={() => useDocumentStore.getState().removeSelected()}><Trash2 size={14} /> Delete feature</button>
    </aside>
  )
}

function SketchProperties({ feature }: { feature: Extract<Feature, { kind: 'sketch' }> }) {
  const bounds = sketchBounds(feature.entities)
  const regions = getProfileRegions(feature)
  const holeCount = regions.reduce((total, region) => total + region.holes.length, 0)
  const features = useDocumentStore((state) => state.document.features)
  const displayUnits = useDocumentStore((state) => state.document.displayUnits ?? 'mm')
  const dependents = features.filter((candidate) => candidate.kind === 'extrude' && candidate.sketchId === feature.id)
  const evaluatedWarning = useFeatureDiagnosticsStore((state) => state.unresolved[feature.id])
  const referenceWarning = evaluatedWarning ?? collectDocumentDiagnostics(features)[feature.id]
  return (
    <aside className="panel properties-panel">
      <div className="panel-header"><span>SKETCH</span><button aria-label="Close properties" onClick={() => useDocumentStore.getState().select(null)}>×</button></div>
      <PropertyIdentity feature={feature} />
      {referenceWarning && <div className="dependency-warning">{referenceWarning.message}</div>}
      <div className="property-section sketch-health">
        <span className={regions.length ? 'healthy' : ''}>{regions.length ? `${regions.length} REGION${regions.length > 1 ? 'S' : ''}${holeCount ? ` · ${holeCount} HOLE${holeCount > 1 ? 'S' : ''}` : ''}` : 'OPEN GEOMETRY'}</span>
        <strong>{feature.plane} plane{Math.abs(feature.parameters.planeOffset) > 1e-9 ? ` @ ${formatLength(feature.parameters.planeOffset, displayUnits)}` : ''}</strong>
        <strong>{feature.entities.length} entities</strong>
        <strong>{feature.constraints.length} constraints</strong>
        {feature.attachment && <strong>{feature.attachment.featureName} · {feature.attachment.faceLabel}</strong>}
      </div>
      {feature.entities.length > 0 && <div className="property-section">
        <h3>Overall dimensions</h3>
        <NumberField label="Width" value={bounds.width} onCommit={(value) => void applySketchResize(feature.id, 0, value)} />
        <NumberField label="Height" value={bounds.height} onCommit={(value) => void applySketchResize(feature.id, 1, value)} />
      </div>}
      <button className="panel-action" onClick={() => useDocumentStore.getState().beginSketch(feature.id)}><SketchFeatureIcon /> Edit sketch</button>
      <div style={{ display: 'flex', gap: '4px' }}>
        <button className="panel-action primary" style={{ flex: 1 }} disabled={!regions.length} onClick={() => useDocumentStore.getState().extrudeSketch(feature.id)}><ExtrudeFeatureIcon /> Extrude</button>
        <button className="panel-action primary" style={{ flex: 1 }} disabled={!regions.length} onClick={() => useDocumentStore.getState().revolveSketch(feature.id)}><RevolveFeatureIcon /> Revolve</button>
      </div>
      {dependents.length > 0 && <div className="dependency-warning">Deleting this sketch will also remove {dependents.length} dependent extrusion{dependents.length > 1 ? 's' : ''}.</div>}
      <button className="delete-feature" onClick={() => {
        if (!dependents.length || window.confirm(`Delete this sketch and ${dependents.length} dependent extrusion${dependents.length > 1 ? 's' : ''}?`)) useDocumentStore.getState().removeSelected()
      }}><Trash2 size={14} /> Delete sketch</button>
    </aside>
  )
}

function ExtrudeProperties({ feature }: { feature: Extract<Feature, { kind: 'extrude' }> }) {
  const updateParameters = useDocumentStore((state) => state.updateParameters)
  const features = useDocumentStore((state) => state.document.features)
  const source = features.find((candidate): candidate is Extract<Feature, { kind: 'sketch' }> =>
    candidate.id === feature.sketchId && candidate.kind === 'sketch')
  const featureIndex = features.findIndex((candidate) => candidate.id === feature.id)
  const hasBaseSolid = features.slice(0, featureIndex).some((candidate) => candidate.kind === 'extrude')
  const onFace = isFaceAttached(source)
  const [exportState, setExportState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ status: 'idle' })
  function downloadSolid(format: 'step' | 'stl') {
    if (source?.kind !== 'sketch') return
    const label = format.toUpperCase()
    setExportState({ status: 'loading', message: `Preparing exact ${label} file…` })
    const exporter = format === 'step' ? exportExactStep : exportExactStl
    void exporter(feature, source, useDocumentStore.getState().document.features).then((blob) => {
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = `${feature.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.${format}`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setExportState({ status: 'success', message: `${label} export downloaded.` })
    }).catch((error) => setExportState({ status: 'error', message: error instanceof Error ? error.message : `${label} export failed.` }))
  }
  return (
    <aside className="panel properties-panel">
      <div className="panel-header"><span>EXTRUDE</span><button aria-label="Close properties" onClick={() => useDocumentStore.getState().select(null)}>×</button></div>
      <PropertyIdentity feature={feature} />
      <div className="property-section">
        <h3>Extent</h3>
        <NumberField label="Distance" value={Math.abs(feature.parameters.distance)} minAbs={0.001} binding={{ featureId: feature.id, key: 'distance' }} formula={feature.formulas?.distance} onCommit={(value) => {
          const sign = feature.parameters.distance < 0 ? -1 : 1
          updateParameters(feature.id, { distance: value * sign })
        }} />
        <label className="checkbox-field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={feature.parameters.distance < 0} onChange={(event) => {
            updateParameters(feature.id, { distance: Math.abs(feature.parameters.distance) * (event.target.checked ? -1 : 1) })
          }} /><span>{onFace
            ? `Flip direction (${feature.parameters.distance < 0 ? 'Into the face — cuts a pocket' : 'Out of the face — adds a boss'})`
            : `Flip direction (${feature.parameters.distance < 0 ? 'Inward / Reverse' : 'Outward / Forward'})`}</span>
        </label>
        <label className="toggle-field"><span>Symmetric</span><input type="checkbox" checked={feature.parameters.symmetric} onChange={(event) => updateParameters(feature.id, { symmetric: event.target.checked })} /></label>
      </div>
      <div className="property-section">
        <h3>Boolean operation</h3>
        <label className="select-field"><span>Result</span><select value={feature.operation} onChange={(event) => useDocumentStore.getState().updateFeature(feature.id, { operation: event.target.value as typeof feature.operation })}>
          <option value="newBody">New body</option>
          <option value="add" disabled={!hasBaseSolid}>Add to previous solid</option>
          <option value="cut" disabled={!hasBaseSolid}>Cut from previous solid</option>
        </select></label>
        {onFace && <small className="field-guidance">On a face, this and the extrusion direction are the same setting — changing either one moves the other.</small>}
        {!hasBaseSolid && <small className="field-guidance">Create an earlier extrusion to enable Add and Cut.</small>}
      </div>
      <div className="property-section feature-info">
        <span>Profile</span><strong>{source?.name ?? 'Missing sketch'}</strong>
        <span>Sketch Plane</span><strong>{source?.attachment?.type === 'face' ? `${source.attachment.featureName} face` : source?.plane || 'Unknown'}</strong>
        <span>Operation</span><strong>{feature.operation === 'newBody' ? 'New body' : feature.operation === 'add' ? 'Boolean add' : 'Boolean cut'}</strong>
        <span>Kernel</span><strong>OpenCascade B-rep</strong>
      </div>
      {source?.kind !== 'sketch' && <div className="dependency-warning">The source sketch is missing. Restore it from Project recovery or delete this broken feature.</div>}
      <OpenProfileWarning feature={feature} />
      {exportState.status !== 'idle' && <div className={`inline-operation ${exportState.status}`}>{exportState.message}</div>}
      <div className="property-section export-section"><h3>Export solid</h3><small>STEP preserves editable B-rep geometry. Binary STL is broadly compatible and uses millimeter coordinates.</small></div>
      <button className="panel-action primary" disabled={source?.kind !== 'sketch' || exportState.status === 'loading'} onClick={() => downloadSolid('step')}><Download /> Export STEP</button>
      <button className="panel-action" disabled={source?.kind !== 'sketch' || exportState.status === 'loading'} onClick={() => downloadSolid('stl')}><Download /> Export STL</button>
      <button className="delete-feature" onClick={() => useDocumentStore.getState().removeSelected()}><Trash2 size={14} /> Delete extrusion</button>
    </aside>
  )
}

const HOLE_FORMS: { form: HoleForm; label: string }[] = [
  { form: 'simple', label: 'Simple' },
  { form: 'counterbore', label: 'Counterbore' },
  { form: 'countersink', label: 'Countersink' },
]

function HoleProperties({ feature }: { feature: HoleFeature }) {
  const updateParameters = useDocumentStore((state) => state.updateParameters)
  const features = useDocumentStore((state) => state.document.features)
  const displayUnits = useDocumentStore((state) => state.document.displayUnits ?? 'mm')
  const source = features.find((candidate) => candidate.id === feature.sketchId)
  const count = holePlacements(feature, features).length
  const { parameters } = feature
  const problem = holeProblem(parameters)
  // A size typed by hand is no longer the preset's size, so the preset goes.
  const setSize = (patch: Partial<HoleParameters>) => updateParameters(feature.id, { ...patch, preset: undefined })
  const field = (label: string, key: 'diameter' | 'depth' | 'headDiameter' | 'headDepth') => (
    <NumberField label={label} value={parameters[key]} minAbs={0.001} binding={{ featureId: feature.id, key }} formula={feature.formulas?.[key]} onCommit={(value) => setSize({ [key]: value })} />
  )
  return (
    <aside className="panel properties-panel">
      <div className="panel-header"><span>HOLE</span><button aria-label="Close properties" onClick={() => useDocumentStore.getState().select(null)}>×</button></div>
      <PropertyIdentity feature={feature} />
      <div className="property-section">
        <h3>Size</h3>
        <label className="select-field"><span>Preset</span><select aria-label="Hole preset" value={parameters.preset ?? ''} onChange={(event) => {
          if (event.target.value) useDocumentStore.getState().updateFeature(feature.id, { parameters: applyHolePreset(parameters, event.target.value) })
        }}>
          <option value="">Custom</option>
          {HOLE_PRESETS.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
        </select></label>
        <label className="select-field"><span>Form</span><select aria-label="Hole form" value={parameters.form} onChange={(event) => setSize({ form: event.target.value as HoleForm })}>
          {HOLE_FORMS.map((option) => <option key={option.form} value={option.form}>{option.label}</option>)}
        </select></label>
        {field('Diameter', 'diameter')}
        <label className="toggle-field"><span>Through all</span><input type="checkbox" checked={parameters.through} onChange={(event) => setSize({ through: event.target.checked })} /></label>
        {!parameters.through && field('Depth', 'depth')}
        {parameters.form !== 'simple' && field(parameters.form === 'counterbore' ? 'Counterbore Ø' : 'Countersink Ø', 'headDiameter')}
        {parameters.form === 'counterbore' && field('Counterbore depth', 'headDepth')}
        {parameters.form === 'countersink' && (
          <NumberField label="Countersink angle" value={parameters.countersinkAngle} minAbs={0.001} binding={{ featureId: feature.id, key: 'countersinkAngle' }} formula={feature.formulas?.countersinkAngle} onCommit={(value) => setSize({ countersinkAngle: value })} />
        )}
      </div>
      {problem && <div className="dependency-warning"><span>{problem} Nothing is drilled until it is fixed.</span></div>}
      <div className="property-section feature-info">
        <span>Callout</span><strong className="hole-callout">{holeCallout(parameters, (value) => formatLengthInput(value, displayUnits))}</strong>
        <span>Placed at</span><strong>{source?.kind === 'sketch' ? `${count} point${count === 1 ? '' : 's'} in ${source.name}` : 'Missing sketch'}</strong>
        <span>Kernel</span><strong>OpenCascade B-rep</strong>
      </div>
      {source?.kind === 'sketch' && !count && <div className="dependency-warning"><span>{source.name} has no points to drill. Add some with the Point tool.</span>
        <button type="button" onClick={() => useDocumentStore.getState().beginSketch(source.id)}>Edit sketch</button>
      </div>}
      <button className="delete-feature" onClick={() => useDocumentStore.getState().removeSelected()}><Trash2 size={14} /> Delete hole</button>
    </aside>
  )
}

function FilletProperties({ feature, onReselectEdges }: { feature: Extract<Feature, { kind: 'fillet' }>; onReselectEdges: (feature: Extract<Feature, { kind: 'fillet' }>) => void }) {
  const updateParameters = useDocumentStore((state) => state.updateParameters)
  const warning = useFeatureDiagnosticsStore((state) => state.unresolved[feature.id])
  const radiusRepair = warning && findDiagnosticRepair(warning, 'apply-radius')
  const edgeRepair = warning && findDiagnosticRepair(warning, 'reselect-edge')
  const chamfer = feature.parameters.blend === 'chamfer'
  return (
    <aside className="panel properties-panel">
      <div className="panel-header"><span>{chamfer ? 'CHAMFER' : 'FILLET'}</span><button aria-label="Close properties" onClick={() => useDocumentStore.getState().select(null)}>×</button></div>
      <PropertyIdentity feature={feature} />
      {warning && <div className="dependency-warning">
        <span>{warning.message}</span>
        {radiusRepair && (
          <button type="button" onClick={() => updateParameters(feature.id, { radius: radiusRepair.value })}>
            {radiusRepair.label} ({formatLength(radiusRepair.value, useDocumentStore.getState().document.displayUnits ?? 'mm')})
          </button>
        )}
        {edgeRepair && (
          <button type="button" onClick={() => onReselectEdges(feature)}>{edgeRepair.label}</button>
        )}
      </div>}
      <div className="property-section">
        <h3>Selected edges</h3>
        <strong className="fillet-edge-count">{feature.edges.length} edge{feature.edges.length === 1 ? '' : 's'} selected</strong>
        <NumberField label={chamfer ? 'Distance' : 'Radius'} value={feature.parameters.radius} minAbs={0.001} binding={{ featureId: feature.id, key: 'radius' }} formula={feature.formulas?.radius} onCommit={(value) => updateParameters(feature.id, { radius: value })} />
      </div>
      {/* A chamfer is a flat cut: it has no corner blend or profile to choose. */}
      {!chamfer && <div className="property-section">
        <h3>Corner Options</h3>
        <label className="select-field">
          <span>Corner Style</span>
          <select
            value={feature.parameters.cornerStyle ?? 'spherical'}
            onChange={(e) => updateParameters(feature.id, { cornerStyle: e.target.value as FilletCornerStyle })}
          >
            <option value="spherical">Spherical Ball Blend</option>
            <option value="mitered">Mitered Sharp Corner</option>
          </select>
        </label>
        <label className="select-field">
          <span>Profile Shape</span>
          <select
            value={feature.parameters.filletShape ?? 'rational'}
            onChange={(e) => updateParameters(feature.id, { filletShape: e.target.value as FilletProfileShape })}
          >
            <option value="rational">Rational (Standard)</option>
            <option value="quasiAngular">Quasi-Angular</option>
            <option value="polynomial">Polynomial</option>
          </select>
        </label>
      </div>}
      <div className="property-section feature-info">
        <span>Target</span><strong>{chamfer ? 'Selected edges' : feature.parameters.cornerStyle === 'mitered' ? 'Mitered edges' : 'Connected corner chain'}</strong>
        <span>Kernel</span><strong>OpenCascade B-rep</strong>
      </div>
      <button className="delete-feature" onClick={() => useDocumentStore.getState().removeSelected()}><Trash2 size={14} /> Delete {chamfer ? 'chamfer' : 'fillet'}</button>
    </aside>
  )
}

/**
 * What a revolve turns about: the sketch's X or Y axis, or one of its
 * centrelines. Picking a centreline keeps the sketch axis as the fallback.
 */
function RevolveAxisField({ feature, sketch }: { feature: Extract<Feature, { kind: 'revolve' }>; sketch: SketchFeature | undefined }) {
  const centrelines = sketch ? revolveAxisCandidates(sketch) : []
  const missing = Boolean(feature.axisEntityId && !centrelines.some((line) => line.id === feature.axisEntityId))
  const value = feature.axisEntityId ? `line:${feature.axisEntityId}` : feature.parameters.axis
  function choose(choice: string) {
    const lineId = choice.startsWith('line:') ? choice.slice(5) : undefined
    const axis = lineId ? feature.parameters.axis : choice as 'X' | 'Y'
    useDocumentStore.getState().updateFeature(feature.id, { axisEntityId: lineId, parameters: { ...feature.parameters, axis } })
  }
  return (
    <label className="select-field"><span>Axis</span><select aria-label="Revolve axis" value={value} onChange={(event) => choose(event.target.value)}>
      <option value="X">Sketch X axis</option>
      <option value="Y">Sketch Y axis</option>
      {centrelines.map((line, index) => <option key={line.id} value={`line:${line.id}`}>Centreline {index + 1}</option>)}
      {missing && <option value={value} disabled>Deleted centreline</option>}
    </select></label>
  )
}

/** A revolve skipped because the centreline it turned about was deleted. */
function RevolveAxisWarning({ feature }: { feature: Feature }) {
  const features = useDocumentStore((state) => state.document.features)
  const diagnostic = collectRevolveAxisDiagnostics(features)[feature.id]
  const repair = diagnostic && findDiagnosticRepair(diagnostic, 'use-sketch-axis')
  if (!diagnostic) return null
  return (
    <div className="dependency-warning">
      <span>{diagnostic.message}</span>
      {repair && <button type="button" onClick={() => useDocumentStore.getState().updateFeature(repair.featureId, { axisEntityId: undefined })}>{repair.label}</button>}
    </div>
  )
}

function RevolveProperties({ feature }: { feature: Extract<Feature, { kind: 'revolve' }> }) {
  const updateParameters = useDocumentStore((state) => state.updateParameters)
  const features = useDocumentStore((state) => state.document.features)
  const source = features.find((candidate) => candidate.id === feature.sketchId)
  const featureIndex = features.findIndex((candidate) => candidate.id === feature.id)
  const hasBaseSolid = features.slice(0, featureIndex).some((candidate) => candidate.kind === 'extrude' || candidate.kind === 'revolve')
  const [exportState, setExportState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ status: 'idle' })
  function downloadSolid(format: 'step' | 'stl') {
    if (source?.kind !== 'sketch') return
    const label = format.toUpperCase()
    setExportState({ status: 'loading', message: `Preparing exact ${label} file…` })
    const exporter = format === 'step' ? exportExactStep : exportExactStl
    void exporter(feature, source, useDocumentStore.getState().document.features).then((blob) => {
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = `${feature.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.${format}`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setExportState({ status: 'success', message: `${label} export downloaded.` })
    }).catch((error) => setExportState({ status: 'error', message: error instanceof Error ? error.message : `${label} export failed.` }))
  }
  return (
    <aside className="panel properties-panel">
      <div className="panel-header"><span>REVOLVE</span><button aria-label="Close properties" onClick={() => useDocumentStore.getState().select(null)}>×</button></div>
      <PropertyIdentity feature={feature} />
      <div className="property-section">
        <h3>Extent</h3>
        <NumberField label="Angle" value={feature.parameters.angle} minAbs={0.001} binding={{ featureId: feature.id, key: 'angle' }} formula={feature.formulas?.angle} onCommit={(value) => updateParameters(feature.id, { angle: Math.min(360, Math.max(0.001, value)) })} />
        <RevolveAxisField feature={feature} sketch={source?.kind === 'sketch' ? source : undefined} />
      </div>
      <div className="property-section">
        <h3>Boolean operation</h3>
        <label className="select-field"><span>Result</span><select value={feature.operation} onChange={(event) => useDocumentStore.getState().updateFeature(feature.id, { operation: event.target.value as typeof feature.operation })}>
          <option value="newBody">New body</option>
          <option value="add" disabled={!hasBaseSolid}>Add to previous solid</option>
          <option value="cut" disabled={!hasBaseSolid}>Cut from previous solid</option>
        </select></label>
      </div>
      <div className="property-section feature-info"><span>Profile</span><strong>{source?.name ?? 'Missing sketch'}</strong><span>Operation</span><strong>{feature.operation === 'newBody' ? 'New body' : feature.operation === 'add' ? 'Boolean add' : 'Boolean cut'}</strong><span>Kernel</span><strong>OpenCascade B-rep</strong></div>
      {source?.kind !== 'sketch' && <div className="dependency-warning">The source sketch is missing. Restore it from Project recovery or delete this broken feature.</div>}
      <OpenProfileWarning feature={feature} />
      <RevolveAxisWarning feature={feature} />
      {exportState.status !== 'idle' && <div className={`inline-operation ${exportState.status}`}>{exportState.message}</div>}
      <div className="property-section export-section"><h3>Export solid</h3><small>STEP preserves editable B-rep geometry. Binary STL is broadly compatible and uses millimeter coordinates.</small></div>
      <button className="panel-action primary" disabled={source?.kind !== 'sketch' || exportState.status === 'loading'} onClick={() => downloadSolid('step')}><Download /> Export STEP</button>
      <button className="panel-action" disabled={source?.kind !== 'sketch' || exportState.status === 'loading'} onClick={() => downloadSolid('stl')}><Download /> Export STL</button>
      <button className="delete-feature" onClick={() => useDocumentStore.getState().removeSelected()}><Trash2 size={14} /> Delete revolve</button>
    </aside>
  )
}

export function PropertiesPanel({ feature, onReselectFilletEdges }: { feature: Feature | null; onReselectFilletEdges: (feature: Extract<Feature, { kind: 'fillet' }>) => void }) {
  if (!feature) {
    return (
      <aside className="panel properties-panel no-selection">
        <div className="panel-header"><span>PROPERTIES</span></div>
        <div className="no-selection-art"><MousePointer2 /><p>Nothing selected</p><span>Select a feature to edit its dimensions and position.</span></div>
      </aside>
    )
  }
  if (feature.kind === 'sketch') return <SketchProperties feature={feature} />
  if (feature.kind === 'extrude') return <ExtrudeProperties feature={feature} />
  if (feature.kind === 'revolve') return <RevolveProperties feature={feature} />
  if (feature.kind === 'fillet') return <FilletProperties feature={feature} onReselectEdges={onReselectFilletEdges} />
  if (feature.kind === 'hole') return <HoleProperties feature={feature} />
  return <PrimitiveProperties feature={feature} />
}
