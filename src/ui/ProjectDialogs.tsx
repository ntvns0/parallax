import { useEffect, useState, type ReactNode } from 'react'
import { ArchiveRestore, Command, Download, FilePlus2, FolderOpen, Keyboard, MousePointer2, Ruler, Sparkles, Trash2, X } from 'lucide-react'
import { clearDiagnostics, downloadDiagnostics, readDiagnostics } from '../core/diagnostics'
import { useDocumentStore } from '../core/document-store'
import {
  measurementEdgeAngle,
  measurementLineOrientation,
  measurementRelativeEdgeAngles,
  measurementValues,
  type MeasurementReference,
  type MeasurementState,
} from '../core/measurement'
import type { CadDocument, DisplayUnits } from '../core/model'
import { formatLength } from '../core/units'
import { MAX_BRIGHTNESS, MIN_BRIGHTNESS, useViewportStore } from '../viewport/viewport-store'
import { exportExactDocument, hasExactSolid } from '../kernel/exact-kernel'
import { getAppCommands } from './commands'
import { downloadBlob, fileStem } from './download'

function downloadDocument(document: CadDocument) {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `${fileStem(document.name)}.parallax.json`)
}

export function DialogShell({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return <div className="dialog-backdrop" onMouseDown={onClose}><section className={`app-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
    <div className="dialog-heading"><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={onClose}><X /></button></div>{children}
  </section></div>
}

export function ProjectMenu({ onClose, onImport, onDrawing }: { onClose: () => void; onImport: () => void; onDrawing: () => void }) {
  const document = useDocumentStore((state) => state.document)
  const projects = useDocumentStore((state) => state.projects)
  const recoverySnapshots = useDocumentStore((state) => state.recoverySnapshots)
  const canDraw = hasExactSolid(document.features)
  return (
    <div className="project-menu" role="dialog" aria-label="Project menu">
      <div className="popover-heading"><div><span>LOCAL PROJECTS</span><strong>{projects.length} stored in this browser</strong></div><button aria-label="Close project menu" onClick={onClose}><X /></button></div>
      <div className="project-actions">
        <button onClick={() => { useDocumentStore.getState().newDocument(); onClose() }}><FilePlus2 /> New part</button>
        <button onClick={() => { onImport(); onClose() }}><FolderOpen /> Import</button>
        <button onClick={() => downloadDocument(document)}><Download /> Download backup</button>
      </div>
      <div className="project-actions single">
        <button
          disabled={!canDraw}
          title={canDraw ? 'Generate a dimensioned drawing sheet' : 'Extrude a sketch into a solid first'}
          onClick={() => { onDrawing(); onClose() }}
        ><Ruler /> Create drawing (PDF)</button>
      </div>
      <div className="popover-section-label">RECENT</div>
      <div className="project-list">
        {projects.map((project) => (
          <div className={`project-item${project.id === document.id ? ' active' : ''}`} key={project.id}>
            <button className="project-open" onClick={() => { useDocumentStore.getState().openDocument(project.id); onClose() }}>
              <span>{project.name}</span><small>{project.id === document.id ? 'Open now' : new Date(project.updatedAt).toLocaleString()}</small>
            </button>
            {project.id !== document.id && <button className="project-delete" aria-label={`Delete ${project.name}`} onClick={() => {
              if (window.confirm(`Delete “${project.name}” from this browser? Download a backup first if you may need it later.`)) useDocumentStore.getState().deleteDocument(project.id)
            }}><Trash2 /></button>}
          </div>
        ))}
      </div>
      {recoverySnapshots.length > 0 && <>
        <div className="popover-section-label">RECOVERY · CURRENT PROJECT</div>
        <div className="recovery-list">
          {recoverySnapshots.slice(0, 5).map((snapshot) => <button key={snapshot.id} onClick={() => { useDocumentStore.getState().restoreRecoverySnapshot(snapshot.id); onClose() }}>
            <ArchiveRestore /><span>Restore {new Date(snapshot.savedAt).toLocaleString()}</span>
          </button>)}
        </div>
      </>}
    </div>
  )
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const document = useDocumentStore((state) => state.document)
  const displayUnits = document.displayUnits ?? 'mm'
  const brightness = useViewportStore((state) => state.brightness)
  const [diagnostics, setDiagnostics] = useState(readDiagnostics)
  const [exportState, setExportState] = useState<{ status: 'idle' | 'loading' | 'error'; message: string | null }>({
    status: 'idle',
    message: null,
  })

  useEffect(() => {
    const refresh = () => setDiagnostics(readDiagnostics())
    window.addEventListener('parallax:diagnostics-changed', refresh)
    return () => window.removeEventListener('parallax:diagnostics-changed', refresh)
  }, [])

  async function handleExport(format: 'step' | 'stl') {
    setExportState({ status: 'loading', message: `Exporting ${format.toUpperCase()} model…` })
    try {
      const blob = await exportExactDocument(document.features, format)
      downloadBlob(blob, `${fileStem(document.name, 'model')}.${format}`)
      setExportState({ status: 'idle', message: null })
    } catch (err) {
      setExportState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Export failed.',
      })
    }
  }

  return <DialogShell title="Workspace settings" onClose={onClose}>
    <div className="dialog-content settings-grid">
      <div><span>Display units</span><select aria-label="Display units" value={displayUnits} onChange={(event) => useDocumentStore.getState().setDisplayUnits(event.target.value as DisplayUnits)}>
        <option value="mm">Millimeters</option>
        <option value="in-decimal">Inches · machinist (.001)</option>
        <option value="in-fractional">Inches · carpenter (1/16)</option>
      </select><small>Geometry remains exact internally; this controls entry, labels, and sketch snapping.</small></div>
      <div><span>Viewport brightness</span>
        <div className="brightness-field">
          <input
            type="range"
            aria-label="Viewport brightness"
            min={MIN_BRIGHTNESS}
            max={MAX_BRIGHTNESS}
            step={0.05}
            value={brightness}
            onChange={(event) => useViewportStore.getState().setBrightness(Number(event.target.value))}
          />
          <output>{Math.round(brightness * 100)}%</output>
          <button disabled={brightness === 1} onClick={() => useViewportStore.getState().setBrightness(1)}>Reset</button>
        </div>
        <small>The lighting rig already scales itself to the part, so this is for taste rather than for large models. Stored per browser, not in the project.</small>
      </div>
      <div><span>Export model</span>
        <div className="export-actions">
          <button disabled={exportState.status === 'loading'} onClick={() => handleExport('step')}>
            <Download size={13} /> Export STEP (.step)
          </button>
          <button disabled={exportState.status === 'loading'} onClick={() => handleExport('stl')}>
            <Download size={13} /> Export STL (.stl)
          </button>
        </div>
        {exportState.message && <p className={`export-status ${exportState.status}`}>{exportState.message}</p>}
        <small>STEP preserves exact B-rep surfaces for CAD interoperability. STL outputs tessellated meshes for 3D printing.</small>
      </div>
      <div><span>Autosave</span><strong>On · local browser storage</strong><small>Each project is stored independently with recovery snapshots.</small></div>
      <div><span>Geometry</span><strong>Exact OpenCascade B-rep</strong><small>Immediate mesh previews are replaced by exact results when ready.</small></div>
      <div className="diagnostic-settings"><span>Diagnostics</span><div className="diagnostic-summary"><strong>{diagnostics.length} recorded event{diagnostics.length === 1 ? '' : 's'}</strong><div><button disabled={!diagnostics.length} onClick={downloadDiagnostics}><Download /> Export</button><button disabled={!diagnostics.length} onClick={clearDiagnostics}><Trash2 /> Clear</button></div></div><small>Errors persist locally across sessions so geometry failures can be investigated over time.</small>
        {diagnostics.length > 0 && <div className="diagnostic-list">{diagnostics.slice(0, 8).map((entry) => <details key={entry.id} className={entry.level}><summary><time>{new Date(entry.timestamp).toLocaleString()}</time><b>{entry.area}</b><span>{entry.message}</span></summary>{entry.context !== undefined && <pre>{JSON.stringify(entry.context, null, 2)}</pre>}</details>)}</div>}
      </div>
    </div>
  </DialogShell>
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return <DialogShell title="Parallax quick guide" onClose={onClose}>
    <div className="dialog-content help-grid">
      <div><Keyboard /><p><strong>Sketch</strong><span>Choose New sketch, draw a closed rectangle or circle, then finish the sketch.</span></p></div>
      <div><Sparkles /><p><strong>Make it solid</strong><span>Select the sketch and choose Extrude profile. Edit its exact depth in Properties.</span></p></div>
      <div><Command /><p><strong>Shortcuts</strong><span>Ctrl+K commands · Ctrl+S save · Ctrl+Z undo · L/R/C sketch tools · Esc finish/cancel.</span></p></div>
    </div>
  </DialogShell>
}

export function CommandPalette({ onClose, onCreateDrawing }: { onClose: () => void; onCreateDrawing?: () => void }) {
  const [query, setQuery] = useState('')
  const commands = getAppCommands({ onCreateDrawing }).filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()))
  return <DialogShell title="Commands" onClose={onClose}>
    <div className="command-palette"><input autoFocus value={query} placeholder="Type a command…" aria-label="Search commands" onChange={(event) => setQuery(event.target.value)} />
      <div>{commands.map((command) => <button key={command.label} onClick={() => { command.run(); onClose() }}><strong>{command.label}</strong><span>{command.detail}</span></button>)}</div>
    </div>
  </DialogShell>
}

export function PlanePicker({ canPickFace, onPickFace, onClose }: { canPickFace: boolean; onPickFace: () => void; onClose: () => void }) {
  return <DialogShell title="Choose a sketch plane" onClose={onClose}>
    <div className="plane-picker">
      <button className="plane-picker-face" disabled={!canPickFace} onClick={onPickFace}>
        <MousePointer2 />
        <span><strong>Pick a model face</strong><small>{canPickFace ? 'Select a flat face directly in the 3D viewport' : 'Create or extrude a solid first'}</small></span>
      </button>
      {(['XY', 'XZ', 'YZ'] as const).map((plane) => <button key={plane} onClick={() => { useDocumentStore.getState().beginSketch(undefined, plane); onClose() }}>
        <span className={`plane-preview ${plane.toLowerCase()}`}>{plane}</span>
        <strong>{plane} plane</strong>
        <small>{plane === 'XY' ? 'Top · extrudes along Z' : plane === 'XZ' ? 'Front · extrudes along Y' : 'Right · extrudes along X'}</small>
      </button>)}
    </div>
  </DialogShell>
}

export function MeasurementPanel({ measurement, onClose }: { measurement: MeasurementState; onClose: () => void }) {
  const document = useDocumentStore((state) => state.document)
  const displayUnits = document.displayUnits ?? 'mm'
  const inspected = measurement.hover ?? measurement.end ?? measurement.start
  const feature = inspected ? document.features.find((candidate) => candidate.id === inspected.featureId) : null
  const result = measurement.start && measurement.end ? measurementValues(measurement.start.point, measurement.end.point) : null
  const angularTarget = measurement.end ?? measurement.hover
  const lineOrientation = measurement.start && angularTarget
    ? measurementLineOrientation(measurement.start.point, angularTarget.point)
    : null
  const relativeAngles = measurement.start && angularTarget
    ? measurementRelativeEdgeAngles(measurement.start, measurement.start.point, angularTarget.point)
    : null
  const betweenEdges = measurement.start && angularTarget ? measurementEdgeAngle(measurement.start, angularTarget) : null
  const angleLabel = (angle: number) => `${Math.abs(angle - Math.round(angle)) < 0.05 ? angle.toFixed(0) : angle.toFixed(1)}°`
  const orientationLabel = lineOrientation?.kind === 'planar'
    ? `${lineOrientation.plane} from ${lineOrientation.datumAxis} · ${angleLabel(lineOrientation.bearing)}`
    : lineOrientation ? `AZ ${angleLabel(lineOrientation.azimuth)} · EL ${angleLabel(lineOrientation.elevation)}` : null
  const labels: Record<string, string> = { width: 'Width', depth: 'Depth', height: 'Height', radius: 'Radius', distance: 'Extent', edgeRadius: 'Fillet', planeOffset: 'Plane offset' }
  const parameters = feature ? Object.entries(feature.parameters).filter(([key, value]) => typeof value === 'number' && key !== 'faceNormalSign').slice(0, 4) as [string, number][] : []
  const signedLength = (value: number) => `${value > 1e-9 ? '+' : ''}${formatLength(value, displayUnits)}`
  const pointLabel = (reference: MeasurementReference) => reference.point.map((value) => formatLength(value, displayUnits)).join(', ')
  return (
    <div className="measurement-panel" role="status">
      <div className="measurement-heading"><div><Ruler /><span>MEASURE</span></div><button aria-label="Close measurement tool" onClick={onClose}><X /></button></div>
      {!measurement.start && <p className="measurement-prompt">Hover a feature and choose the first reference point.</p>}
      {measurement.start && <div className="measurement-reference"><span>FROM · {measurement.start.snapType}{measurement.start.radius ? ` · Ø ${formatLength(measurement.start.radius * 2, displayUnits)}` : ''}</span><strong>{measurement.start.featureName}</strong><code>{pointLabel(measurement.start)}</code></div>}
      {measurement.start && !measurement.end && <p className="measurement-prompt">Choose a second point, edge, face center, or feature center. Two straight edge snaps also measure their included angle.</p>}
      {!measurement.end && relativeAngles && <div className="measurement-angle-preview"><span>FROM EDGE · SMALL / SUPPLEMENT</span><strong>{angleLabel(relativeAngles.smaller)} / {angleLabel(relativeAngles.supplementary)}</strong></div>}
      {measurement.end && <div className="measurement-reference end"><span>TO · {measurement.end.snapType}{measurement.end.radius ? ` · Ø ${formatLength(measurement.end.radius * 2, displayUnits)}` : ''}</span><strong>{measurement.end.featureName}</strong><code>{pointLabel(measurement.end)}</code></div>}
      {result && <div className="measurement-result">
        <div className="measurement-total"><span>Distance</span><strong>{formatLength(result.distance, displayUnits)}</strong></div>
        {orientationLabel && <div className="measurement-total measurement-angle-total"><span>Line bearing</span><strong>{orientationLabel}</strong></div>}
        {relativeAngles && <div className="measurement-total measurement-angle-detail"><span>From edge · small / supplement</span><strong>{angleLabel(relativeAngles.smaller)} / {angleLabel(relativeAngles.supplementary)}</strong></div>}
        {betweenEdges !== null && <div className="measurement-total measurement-angle-detail"><span>Between snapped edges</span><strong>{angleLabel(betweenEdges)}</strong></div>}
        <dl><dt>ΔX</dt><dd>{signedLength(result.delta[0])}</dd><dt>ΔY</dt><dd>{signedLength(result.delta[1])}</dd><dt>ΔZ</dt><dd>{signedLength(result.delta[2])}</dd></dl>
        <p>Click another reference to begin a new measurement.</p>
      </div>}
      {inspected && <div className="measurement-inspect">
        <div><span>UNDER POINTER</span><b>{inspected.featureName}</b><em>{inspected.featureKind} · {inspected.snapType}</em></div>
        <code>X {formatLength(inspected.point[0], displayUnits)} · Y {formatLength(inspected.point[1], displayUnits)} · Z {formatLength(inspected.point[2], displayUnits)}</code>
        {inspected.radius && <code>Detected diameter {formatLength(inspected.radius * 2, displayUnits)}</code>}
        {parameters.length > 0 && <dl>{parameters.map(([key, value]) => <span key={key}><dt>{labels[key] ?? key}</dt><dd>{formatLength(value, displayUnits)}</dd></span>)}</dl>}
      </div>}
      <div className="measurement-hint">Design-intent snap radius 18 px · Esc to close</div>
    </div>
  )
}
