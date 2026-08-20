import { Suspense, lazy, useEffect, useReducer, useRef, useState, type ChangeEvent } from 'react'
import {
  ChevronDown,
  CircleHelp,
  Download,
  FilePlus2,
  FolderOpen,
  Grid3X3,
  MousePointer2,
  Redo2,
  Save,
  Settings,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import { prepareFilletFeature, useDocumentStore } from '../core/document-store'
import { anchorEdgeReferences } from '../core/edge-anchor'
import { logDiagnostic } from '../core/diagnostics'
import { validateCadDocument, type CadDocument, type Feature, type FilletCornerStyle, type FilletEdgeReference } from '../core/model'
import { formatLength, formatLengthInput, parseLengthInput, sketchSnapIncrement, unitLabel } from '../core/units'
import { cachedExactMesh, preflightExactFillet, useKernelStore } from '../kernel/exact-kernel'
import { expandConnectedFilletEdges, extractMeshEdges } from '../kernel/fillet-edge-reference'
import { SketchEditor } from '../sketcher/SketchEditor'
import { SceneViewport, type SketchFacePickResult } from '../viewport/SceneViewport'
import { useViewportStore } from '../viewport/viewport-store'
import { FeaturePanel } from './FeatureTree'
import { FilletFeatureIcon } from './icons'
import { INITIAL_INTERACTION_MODE, interactionModeReducer } from './interaction-mode'
import { CommandPalette, HelpDialog, MeasurementPanel, PlanePicker, ProjectMenu, SettingsDialog } from './ProjectDialogs'
import { PropertiesPanel } from './PropertyPanel'
import { EmptyState, IconButton, ModelToolbar, ViewCube } from './Toolbar'

/**
 * Drawing production — projection, sheet layout, and the PDF writer — is loaded
 * only when someone asks for a drawing. None of it is needed to model, and it
 * is a large enough body of code to be worth keeping out of the first paint of
 * an application that already has two WebAssembly kernels to fetch.
 */
const DrawingDialog = lazy(async () => ({ default: (await import('./DrawingDialog')).DrawingDialog }))

export function App() {
  const document = useDocumentStore((state) => state.document)
  const selectedId = useDocumentStore((state) => state.selectedId)
  const pastCount = useDocumentStore((state) => state.past.length)
  const futureCount = useDocumentStore((state) => state.future.length)
  const savedAt = useDocumentStore((state) => state.savedAt)
  const saveStatus = useDocumentStore((state) => state.saveStatus)
  const saveError = useDocumentStore((state) => state.saveError)
  const activeSketchId = useDocumentStore((state) => state.activeSketchId)
  const ready = useDocumentStore((state) => state.ready)
  const displayUnits = document.displayUnits ?? 'mm'
  const kernel = useKernelStore()
  const cameraDistance = useViewportStore((state) => state.cameraDistance)

  const addFeature = useDocumentStore((state) => state.addFeature)
  const undo = useDocumentStore((state) => state.undo)
  const redo = useDocumentStore((state) => state.redo)
  const save = useDocumentStore((state) => state.save)

  const importInput = useRef<HTMLInputElement>(null)

  const [mode, dispatch] = useReducer(interactionModeReducer, INITIAL_INTERACTION_MODE)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [drawingOpen, setDrawingOpen] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const selectedFeature = document.features.find((feature) => feature.id === selectedId) ?? null
  const canPickSketchFace = document.features.some((feature) => feature.visible && feature.kind !== 'sketch')

  function handleSketchFacePick(result: SketchFacePickResult) {
    if (!result.ok) {
      logDiagnostic('warning', 'Sketch face selection', result.message)
      setNotice({ tone: 'error', message: result.message })
      return
    }
    useDocumentStore.getState().beginSketch(undefined, result.plane, result.planeOffset, result.faceNormalSign, result.attachment)
    dispatch({ type: 'CANCEL' })
    logDiagnostic('info', 'Sketch face selection', `Created a sketch on ${result.featureName}.`, result)
    setNotice({ tone: 'success', message: `Sketching on ${result.featureName} · ${result.plane} plane at ${formatLength(result.planeOffset, displayUnits)}.` })
  }

  function startFillet(target: Extract<Feature, { kind: 'extrude' | 'fillet' }>) {
    dispatch({ type: 'START_FILLET', targetId: target.id, initialRadiusDraft: formatLengthInput(2, displayUnits) })
    setNotice(null)
  }

  function startFilletReselection(feature: Extract<Feature, { kind: 'fillet' }>) {
    const featureIndex = document.features.findIndex((candidate) => candidate.id === feature.id)
    const target = [...document.features.slice(0, featureIndex)].reverse().find(
      (candidate) => candidate.kind === 'extrude' || candidate.kind === 'revolve' || candidate.kind === 'fillet',
    )
    if (!target) {
      setNotice({ tone: 'error', message: 'No earlier solid is available for edge reselection.' })
      return
    }
    dispatch({
      // The unresolved feature owns the fallback mesh displayed in the viewport;
      // select from that mesh, then preflight against the earlier solid below.
      type: 'START_FILLET', targetId: feature.id, editingFeatureId: feature.id,
      initialRadiusDraft: formatLengthInput(feature.parameters.radius, displayUnits),
      initialCornerStyle: feature.parameters.cornerStyle,
    })
    setNotice(null)
  }

  function addFilletEdge(edge: FilletEdgeReference) {
    if (mode.kind !== 'fillet-selection') return
    let toAdd = [edge]
    if (mode.propagate && mode.targetId) {
      const targetFeature = document.features.find(
        (f): f is Extract<Feature, { kind: 'extrude' | 'fillet' | 'revolve' }> =>
          f.id === mode.targetId && (f.kind === 'extrude' || f.kind === 'fillet' || f.kind === 'revolve')
      )
      if (targetFeature) {
        const mesh = cachedExactMesh(targetFeature, document.features)
        if (mesh) {
          const allEdges = extractMeshEdges(mesh)
          toAdd = expandConnectedFilletEdges([edge], allEdges)
        }
      }
    }
    dispatch({ type: 'TOGGLE_FILLET_EDGES', edgesToToggle: toAdd })
  }

  async function applyFillet() {
    if (mode.kind !== 'fillet-selection' || !mode.edges.length || mode.status.applying) return
    const radius = parseLengthInput(mode.radiusDraft, displayUnits)
    if (radius === null || radius < 0.001) {
      dispatch({ type: 'SET_FILLET_STATUS', status: { applying: false, error: `Enter a radius of at least ${formatLength(0.001, displayUnits)}.` } })
      return
    }
    dispatch({ type: 'SET_FILLET_STATUS', status: { applying: true, error: null } })
    try {
      const store = useDocumentStore.getState()
      if (mode.editingFeatureId) {
        const featureIndex = store.document.features.findIndex((candidate) => candidate.id === mode.editingFeatureId)
        const current = store.document.features[featureIndex]
        if (current?.kind !== 'fillet') throw new Error('The fillet being repaired is no longer available.')
        const priorFeatures = store.document.features.slice(0, featureIndex)
        const target = [...priorFeatures].reverse().find(
          (candidate) => candidate.kind === 'extrude' || candidate.kind === 'revolve' || candidate.kind === 'fillet',
        )
        if (!target) throw new Error('No earlier solid is available for edge reselection.')
        const feature = {
          ...current,
          edges: anchorEdgeReferences(mode.edges, store.document.features),
          parameters: { ...current.parameters, radius, cornerStyle: mode.cornerStyle },
        }
        await preflightExactFillet(target.id, feature, priorFeatures)
        useDocumentStore.getState().updateFeature(feature.id, { edges: feature.edges, parameters: feature.parameters })
        setNotice({ tone: 'success', message: `${feature.name} reattached to ${mode.edges.length} selected edge${mode.edges.length === 1 ? '' : 's'}.` })
      } else {
        const feature = prepareFilletFeature(mode.edges, radius, store.document.features, { cornerStyle: mode.cornerStyle })
        await preflightExactFillet(mode.targetId, feature, store.document.features)
        useDocumentStore.getState().addFillet(feature)
        setNotice({ tone: 'success', message: `${formatLength(radius, displayUnits)} fillet added to ${mode.edges.length} selected edge${mode.edges.length === 1 ? '' : 's'}.` })
      }
      dispatch({ type: 'CANCEL' })
    } catch (error) {
      dispatch({ type: 'SET_FILLET_STATUS', status: { applying: false, error: error instanceof Error ? error.message : 'The exact kernel could not create that fillet.' } })
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const editing = event.target instanceof HTMLInputElement
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((open) => !open)
      } else if (event.key.toLowerCase() === 'f' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('parallax:set-view', { detail: 'fit' }))
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !editing) {
        useDocumentStore.getState().removeSelected()
      } else if (event.key === 'Escape') {
        if (mode.kind !== 'idle') dispatch({ type: 'CANCEL' })
        else useDocumentStore.getState().select(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode.kind, redo, save, undo])

  useEffect(() => {
    void useDocumentStore.getState().hydrate()
  }, [])

  useEffect(() => {
    function onWindowError(event: ErrorEvent) {
      logDiagnostic('error', 'Application', event.message || 'Unhandled browser error', { filename: event.filename, line: event.lineno, column: event.colno, stack: event.error instanceof Error ? event.error.stack : undefined })
    }
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason instanceof Error ? { message: event.reason.message, stack: event.reason.stack } : String(event.reason)
      logDiagnostic('error', 'Application promise', event.reason instanceof Error ? event.reason.message : 'Unhandled promise rejection', reason)
    }
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as CadDocument
      const validation = validateCadDocument(parsed)
      if (!validation.valid) throw new Error(validation.errors.slice(0, 3).join(' '))
      await useDocumentStore.getState().importDocument(parsed)
      setNotice({ tone: 'success', message: `Imported “${parsed.name}” as a separate local project.` })
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'That file is not a valid Parallax project.' })
    } finally {
      event.target.value = ''
    }
  }

  const facePickerActive = mode.kind === 'face-picker'
  const faceHover = mode.kind === 'face-picker' ? mode.hover : null
  const filletTargetId = mode.kind === 'fillet-selection' ? mode.targetId : null
  const measureActive = mode.kind === 'measurement'
  const measurement = mode.kind === 'measurement' ? mode.measurement : { hover: null, start: null, end: null }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><Sparkles size={16} strokeWidth={1.8} /></div>
        <button className="wordmark" title="Open command palette (Ctrl+K)" onClick={() => setCommandOpen(true)}>PARALLAX</button>
        <div className="topbar-divider" />
        <input
          className="document-title"
          value={document.name}
          onChange={(event) => useDocumentStore.getState().renameDocument(event.target.value)}
          aria-label="Document name"
        />
        <span className={`save-state ${saveStatus}`} title={saveError ?? (savedAt ? `Last saved ${new Date(savedAt).toLocaleTimeString()}` : undefined)}>
          <span className="save-dot" />
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? 'Unsaved changes' : saveStatus === 'error' ? 'Save failed' : 'Saved locally'}
        </span>
        <span className={`kernel-state ${kernel.status}`} title={kernel.message}>
          {kernel.status === 'ready' ? 'EXACT B-REP' : kernel.status === 'loading' ? 'KERNEL LOADING' : kernel.status === 'error' ? 'B-REP ERROR' : 'B-REP AVAILABLE'}
        </span>
        <div className="topbar-actions">
          <IconButton label="New part" onClick={() => useDocumentStore.getState().newDocument()}><FilePlus2 /></IconButton>
          <IconButton label="Open project" onClick={() => importInput.current?.click()}><FolderOpen /></IconButton>
          <IconButton label="Save locally (Ctrl+S)" onClick={save}><Save /></IconButton>
          <div className="topbar-divider compact" />
          <IconButton label="Undo (Ctrl+Z)" disabled={!pastCount} onClick={undo}><Undo2 /></IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!futureCount} onClick={redo}><Redo2 /></IconButton>
          <button className="export-button" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen((open) => !open)}><Download size={15} /> Project <ChevronDown size={13} /></button>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}><Settings /></IconButton>
          <IconButton label="Help" onClick={() => setHelpOpen(true)}><CircleHelp /></IconButton>
        </div>
        {projectMenuOpen && <ProjectMenu onClose={() => setProjectMenuOpen(false)} onImport={() => importInput.current?.click()} onDrawing={() => setDrawingOpen(true)} />}
        <input ref={importInput} type="file" accept=".json,.parallax.json" hidden onChange={importProject} />
      </header>

      {(notice || saveError || kernel.status === 'error') && (
        <div className={`app-notice ${notice?.tone ?? 'error'}${activeSketchId ? ' during-sketch' : ''}`} role="status">
          <span>{notice?.message ?? saveError ?? kernel.message}</span>
          <button aria-label="Dismiss notification" onClick={() => {
            setNotice(null)
            if (kernel.status === 'error') useKernelStore.setState({ status: 'idle', message: 'Exact kernel available' })
            if (saveError) useDocumentStore.setState({ saveError: null, saveStatus: 'unsaved' })
          }}><X /></button>
        </div>
      )}

      <section className="workspace">
        <FeaturePanel onMenu={() => setCommandOpen(true)} />
        <section className="viewport-wrap">
          <SceneViewport
            pickSketchFace={facePickerActive}
            onSketchFacePick={handleSketchFacePick}
            onSketchFaceHover={(h) => dispatch({ type: 'SET_FACE_HOVER', hover: h })}
            measureMode={measureActive}
            onMeasurementChange={(m) => dispatch({ type: 'SET_MEASUREMENT', measurement: m })}
            filletTargetId={filletTargetId}
            filletEdges={mode.kind === 'fillet-selection' ? mode.edges : undefined}
            onFilletEdgePick={({ edge }) => addFilletEdge(edge)}
            onFilletEdgeMiss={() => dispatch({ type: 'SET_FILLET_STATUS', status: { applying: false, error: 'No exact edge was found near that point. Move closer to an edge and try again.' } })}
          />
          {!activeSketchId && mode.kind === 'idle' && (
            <ModelToolbar
              onAdd={addFeature}
              selectedFeature={selectedFeature}
              onStartSketch={() => dispatch({ type: 'OPEN_PLANE_PICKER' })}
              measureActive={false}
              onMeasureChange={(active) => {
                if (active) dispatch({ type: 'TOGGLE_MEASUREMENT' })
              }}
              onStartFillet={startFillet}
            />
          )}
          {measureActive && (
            <ModelToolbar
              onAdd={addFeature}
              selectedFeature={selectedFeature}
              onStartSketch={() => dispatch({ type: 'OPEN_PLANE_PICKER' })}
              measureActive={true}
              onMeasureChange={(active) => {
                if (!active) dispatch({ type: 'CANCEL' })
              }}
              onStartFillet={startFillet}
            />
          )}
          {/*
            The sketch editor covers the viewport and locks the camera to the
            sketch plane, so the cube has nothing to orient while it is open —
            and it shares the top-right corner with the sketch position panel.
          */}
          {!activeSketchId && <ViewCube />}
          {ready && document.features.length === 0 && !activeSketchId && mode.kind === 'idle' && (
            <EmptyState onAdd={addFeature} onStartSketch={() => dispatch({ type: 'OPEN_PLANE_PICKER' })} />
          )}
          {!activeSketchId && mode.kind === 'idle' && (
            <div className="viewport-hint"><MousePointer2 size={13} /> Select an object · Drag the gizmo · Scroll to zoom</div>
          )}
          {facePickerActive && (
            <div className={`face-pick-banner${faceHover && !faceHover.ok ? ' invalid' : ''}`} role="status">
              <MousePointer2 />
              <span>
                <strong>SELECT SKETCH PLANE</strong>
                {faceHover?.ok
                  ? `${faceHover.featureName} · ${faceHover.attachment.faceLabel} · ${formatLength(faceHover.attachment.bounds.max[0] - faceHover.attachment.bounds.min[0], displayUnits)} × ${formatLength(faceHover.attachment.bounds.max[1] - faceHover.attachment.bounds.min[1], displayUnits)} · click to select`
                  : faceHover?.message ?? 'Hover over an axis-aligned planar face'}
              </span>
              <button onClick={() => dispatch({ type: 'CANCEL' })}>Cancel</button>
            </div>
          )}
          {mode.kind === 'fillet-selection' && (
            <div className="face-pick-banner fillet-pick-banner" role="status">
              <FilletFeatureIcon />
              <span>
                <strong>{mode.editingFeatureId ? 'RESELECT FILLET EDGES' : 'SELECT EDGES TO FILLET'}</strong>
                {mode.status.error ?? (mode.edges.length ? `${mode.edges.length} edge${mode.edges.length === 1 ? '' : 's'} selected · set a radius and apply` : 'Click sharp edges · connected corner edges auto-propagate')}
              </span>
              <label className="fillet-radius-field">
                <span>Radius</span>
                <input
                  aria-label="Fillet radius"
                  value={mode.radiusDraft}
                  onChange={(event) => dispatch({ type: 'SET_FILLET_RADIUS_DRAFT', draft: event.target.value })}
                  onKeyDown={(event) => { if (event.key === 'Enter') void applyFillet() }}
                />
                <em>{unitLabel(displayUnits)}</em>
              </label>
              <label className="fillet-corner-style" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-color, #e0e0e0)', cursor: 'pointer' }}>
                <span>Corners</span>
                <select
                  value={mode.cornerStyle}
                  onChange={(e) => dispatch({ type: 'SET_FILLET_CORNER_STYLE', style: e.target.value as FilletCornerStyle })}
                  style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '2px 4px', fontSize: '12px' }}
                >
                  <option value="spherical">Spherical Blend</option>
                  <option value="mitered">Mitered Sharp</option>
                </select>
              </label>
              <label className="fillet-propagate-toggle" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-color, #e0e0e0)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={mode.propagate} onChange={(event) => dispatch({ type: 'SET_FILLET_PROPAGATE', propagate: event.target.checked })} />
                <span>Propagate corners</span>
              </label>
              <button disabled={!mode.edges.length || mode.status.applying} onClick={() => void applyFillet()}>{mode.status.applying ? 'Checking…' : mode.editingFeatureId ? 'Reattach' : 'Apply'}</button>
              <button disabled={mode.status.applying} onClick={() => dispatch({ type: 'CANCEL' })}>Cancel</button>
            </div>
          )}
          {measureActive && <MeasurementPanel measurement={measurement} onClose={() => dispatch({ type: 'CANCEL' })} />}
          {activeSketchId && <SketchEditor sketchId={activeSketchId} />}
        </section>
        <PropertiesPanel feature={selectedFeature} onReselectFilletEdges={startFilletReselection} />
      </section>

      <footer className="statusbar">
        <div><span className="status-ready" /> Ready</div>
        <div className="status-center">{kernel.status === 'ready' ? 'OPENCASCADE EXACT KERNEL' : activeSketchId ? 'FREECAD PLANEGCS SKETCH' : 'PARAMETRIC EVALUATOR'} <span>·</span> DOUBLE PRECISION</div>
        <div><Grid3X3 size={13} /> Grid {displayUnits === 'mm' ? '10 mm' : '1 in'} <span className="status-separator">|</span> Snap {formatLength(sketchSnapIncrement(displayUnits), displayUnits)} <span className="status-separator">|</span> <span title="Camera distance from the origin">Eye {formatLength(cameraDistance, displayUnits)}</span> <span className="status-separator">|</span> Units: {displayUnits === 'mm' ? 'mm' : displayUnits === 'in-decimal' ? 'in · .001' : 'in · 1/16'}</div>
      </footer>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onCreateDrawing={() => setDrawingOpen(true)} />}
      {drawingOpen && (
        <Suspense fallback={<div className="dialog-backdrop"><p className="drawing-status">Loading drawing tools…</p></div>}>
          <DrawingDialog onClose={() => setDrawingOpen(false)} />
        </Suspense>
      )}
      {mode.kind === 'plane-picker' && (
        <PlanePicker
          canPickFace={canPickSketchFace}
          onPickFace={() => {
            useDocumentStore.getState().select(null)
            dispatch({ type: 'START_FACE_PICKER' })
          }}
          onClose={() => dispatch({ type: 'CANCEL' })}
        />
      )}
    </main>
  )
}
