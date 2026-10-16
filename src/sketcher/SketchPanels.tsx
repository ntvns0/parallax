import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  Circle,
  Crosshair,
  Focus,
  Maximize2,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  RotateCcw,
  Scissors,
  Spline,
  SquareDashed,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useDocumentStore } from '../core/document-store'
import type { DisplayUnits, LineEntity, SketchFaceAttachment, SketchFeature, Vec2 } from '../core/model'
import { formatLength, formatLengthInput, parseLengthInput, unitLabel } from '../core/units'
import type { SolverState } from './constraint-solver'
import { applySketchPointPosition, applySketchPosition } from './sketch-edits'
import { distance } from './sketch-geometry-builders'
import { INITIAL_SCALE } from './sketch-view'
import { SKETCH_TOOLS, type AngleSnap, type EditorTool } from './sketch-tools'

/**
 * The HTML around the sketch surface: what is being edited, the solver's
 * verdict, typed coordinates, the tool bar, and the view buttons.
 *
 * Panels that edit the sketch hold their own drafts and commit through
 * `sketch-edits`, so a half-typed value never reaches the document.
 */

export function SketchBanner({ sketch, units }: { sketch: SketchFeature; units: DisplayUnits }) {
  const offset = sketch.parameters.planeOffset
  return <div className="sketch-mode-banner">
    <span>EDITING</span> {sketch.name} <em>{sketch.plane} PLANE{Math.abs(offset) > 1e-9 ? ` @ ${formatLength(offset, units)}` : ''}</em>
  </div>
}

export function SolverBadge({ solver }: { solver: SolverState }) {
  const label = solver.status === 'loading' ? 'SOLVING…'
    : solver.status === 'error' ? 'CONSTRAINT ISSUE'
      : solver.degreesOfFreedom === 0 ? 'FULLY CONSTRAINED'
        : solver.degreesOfFreedom === null ? 'SOLVER READY'
          : `${solver.degreesOfFreedom} DOF REMAIN`
  return <div className={`solver-badge ${solver.status}`} title={solver.message}><span /> {label}</div>
}

export function FaceReferencePanel({ attachment, units }: { attachment: SketchFaceAttachment; units: DisplayUnits }) {
  const { min, max } = attachment.bounds
  return <div className="face-reference-panel">
    <div><span>ATTACHED FACE</span><strong>{attachment.featureName} · {attachment.faceLabel}</strong></div>
    <dl>
      <dt>Size</dt><dd>{formatLength(max[0] - min[0], units)} × {formatLength(max[1] - min[1], units)}</dd>
      <dt>Center</dt><dd>{formatLength(attachment.center[0], units)}, {formatLength(attachment.center[1], units)}</dd>
      <dt>Area</dt><dd>{units === 'mm' ? `${attachment.area.toFixed(1)} mm²` : `${(attachment.area / 645.16).toFixed(3)} in²`}</dd>
    </dl>
    <p>Snap targets: center, corners, edge midpoints, and edges</p>
  </div>
}

function lineDraft(line: LineEntity, units: DisplayUnits): [string, string, string, string] {
  return [
    formatLengthInput(line.start[0], units),
    formatLengthInput(line.start[1], units),
    formatLengthInput(line.end[0], units),
    formatLengthInput(line.end[1], units),
  ]
}

/** Typed absolute coordinates for the ends of the selected line. */
export function LineEndpointPanel({ sketchId, line, units }: { sketchId: string; line: LineEntity; units: DisplayUnits }) {
  const [draft, setDraft] = useState(() => lineDraft(line, units))
  useEffect(() => setDraft(lineDraft(line, units)), [line, units])

  function commit(pointRef: 'start' | 'end') {
    const offset = pointRef === 'start' ? 0 : 2
    const parsed = [parseLengthInput(draft[offset], units), parseLengthInput(draft[offset + 1], units)]
    if (parsed.some((value) => value === null)) {
      setDraft(lineDraft(line, units))
      return
    }
    const target = parsed as Vec2
    if (distance(line[pointRef], target) < 1e-9) return
    void applySketchPointPosition(sketchId, line.id, pointRef, target)
  }

  return <div className="line-endpoint-panel">
    <div className="sketch-position-heading">
      <span>LINE ENDPOINTS</span>
      <small>absolute</small>
    </div>
    {(['start', 'end'] as const).map((pointRef, pointIndex) => (
      <div className="endpoint-coordinate-row" key={pointRef}>
        <strong>{pointRef.toUpperCase()}</strong>
        {(['X', 'Y'] as const).map((axis, axisIndex) => {
          const draftIndex = pointIndex * 2 + axisIndex
          return <label key={axis}>
            <span>{axis}</span>
            <input
              aria-label={`Line ${pointRef} ${axis}`}
              inputMode="decimal"
              value={draft[draftIndex]}
              onChange={(event) => setDraft((current) => {
                const next: [string, string, string, string] = [...current]
                next[draftIndex] = event.target.value
                return next
              })}
              onBlur={() => commit(pointRef)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setDraft(lineDraft(line, units))
                  event.currentTarget.blur()
                }
              }}
            />
          </label>
        })}
      </div>
    ))}
    <p>Drag a handle · Alt-drag bypasses snapping</p>
  </div>
}

/**
 * Where the selected profile — or, with nothing selected, the whole sketch —
 * is centred, as typed coordinates.
 */
export function PositionPanel({ sketchId, center, entityIds, hasSelection, attachment, besideLineEndpoints, units }: {
  sketchId: string
  center: Vec2
  entityIds: Set<string>
  hasSelection: boolean
  attachment: SketchFaceAttachment | undefined
  besideLineEndpoints: boolean
  units: DisplayUnits
}) {
  const format = (point: Vec2): [string, string] => [formatLengthInput(point[0], units), formatLengthInput(point[1], units)]
  const [draft, setDraft] = useState(() => format(center))
  // Escape restores the draft and then blurs; the blur must not commit it.
  const skipCommitRef = useRef(false)
  useEffect(() => setDraft([formatLengthInput(center[0], units), formatLengthInput(center[1], units)]), [center, units])

  function commit() {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }
    const current = format(center)
    if (draft[0] === current[0] && draft[1] === current[1]) return
    const parsed = draft.map((value) => parseLengthInput(value, units))
    if (parsed.some((value) => value === null)) {
      setDraft(current)
      return
    }
    const target = parsed as Vec2
    if (Math.abs(target[0] - center[0]) < 1e-9 && Math.abs(target[1] - center[1]) < 1e-9) return
    void applySketchPosition(sketchId, entityIds, target)
  }

  function centerAt(target: Vec2) {
    setDraft(format(target))
    void applySketchPosition(sketchId, entityIds, target)
  }

  return <div className={`sketch-position-panel${besideLineEndpoints ? ' with-line-endpoints' : ''}`}>
    <div className="sketch-position-heading">
      <span>{hasSelection ? 'SELECTION' : 'SKETCH'} POSITION</span>
      <small>center</small>
    </div>
    <div className="sketch-position-fields">
      {(['X', 'Y'] as const).map((axis, index) => (
        <label key={axis}>
          <span>{axis}</span>
          <input
            aria-label={`${hasSelection ? 'Selection' : 'Sketch'} center ${axis}`}
            inputMode="decimal"
            value={draft[index]}
            onChange={(event) => setDraft((current) => {
              const next: [string, string] = [...current]
              next[index] = event.target.value
              return next
            })}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                skipCommitRef.current = true
                setDraft(format(center))
                event.currentTarget.blur()
              }
            }}
          />
          <em>{unitLabel(units)}</em>
        </label>
      ))}
    </div>
    <button onMouseDown={(event) => event.preventDefault()} onClick={() => centerAt([0, 0])}><Crosshair /> Center at 0,0</button>
    {attachment && <button className="center-on-face" onMouseDown={(event) => event.preventDefault()} onClick={() => centerAt(attachment.center)}><Crosshair /> Center on face</button>}
    <p>{hasSelection ? 'Positions the connected profile' : 'Positions all sketch geometry'}</p>
  </div>
}

const TOOL_ICONS: Record<EditorTool, ReactNode> = {
  select: <MousePointer2 />,
  line: <PenLine />,
  rectangle: <RectangleHorizontal />,
  circle: <Circle />,
  arc: <Spline />,
  'three-point-arc': <Spline />,
  'tangent-arc': <Spline />,
  point: <Crosshair />,
  trim: <Scissors />,
}

export function SketchToolbar({ tool, angleSnap, onAngleSnap, fillet, offset, onConstruction, onUndo, onDelete }: {
  tool: EditorTool
  angleSnap: AngleSnap
  onAngleSnap: (value: AngleSnap) => void
  /** The corner fillet control, shown when two entities are selected. */
  fillet: { draft: string; onDraft: (value: string) => void; onApply: () => void } | null
  /** The offset control, shown when curves are selected. A negative distance goes inward. */
  offset: { draft: string; onDraft: (value: string) => void; onApply: () => void } | null
  /** Toggle the selection between construction and profile geometry, when something is selected. */
  onConstruction: (() => void) | null
  onUndo: () => void
  onDelete: (() => void) | null
}) {
  const setTool = (next: EditorTool) => useDocumentStore.getState().setSketchTool(next)
  return <div className="sketch-toolbar">
    {SKETCH_TOOLS.map((entry) => (
      <button key={entry.tool} className={tool === entry.tool ? 'active' : ''} onClick={() => setTool(entry.tool)} title={entry.title}>
        {TOOL_ICONS[entry.tool]} {entry.label} <kbd>{entry.key}</kbd>
      </button>
    ))}
    <label className="angle-snap-control" title="Smart mode acquires common 0°, 45°, 90° and 135° directions">
      <span>ANGLE</span>
      <select value={angleSnap} onChange={(event) => onAngleSnap(Number(event.target.value) as AngleSnap)}>
        <option value={0}>Smart</option>
        <option value={15}>15°</option>
        <option value={30}>30°</option>
        <option value={45}>45°</option>
      </select>
    </label>
    <span className="sketch-toolbar-separator" />
    {fillet && (
      <label className="sketch-fillet-control" title="Round the corner between the two selected lines">
        <span>FILLET R</span>
        <input
          aria-label="Sketch fillet radius"
          value={fillet.draft}
          onChange={(event) => fillet.onDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') fillet.onApply() }}
        />
        <button onClick={fillet.onApply}>Apply</button>
      </label>
    )}
    {offset && (
      <label className="sketch-fillet-control" title="Copy the selected chain or circles this far outward; a negative distance goes inward">
        <span>OFFSET</span>
        <input
          aria-label="Sketch offset distance"
          value={offset.draft}
          onChange={(event) => offset.onDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') offset.onApply() }}
        />
        <button onClick={offset.onApply}>Apply</button>
      </label>
    )}
    {onConstruction && <button title="Construction geometry is solved and snapped to, but never part of a profile" onClick={onConstruction}><SquareDashed /> Construction <kbd>Q</kbd></button>}
    <button onClick={onUndo}><RotateCcw /> Undo</button>
    {onDelete && <button title="Delete selected entity" onClick={onDelete}><Trash2 /> Delete</button>}
    <button className="finish-sketch" onClick={() => useDocumentStore.getState().finishSketch()}><Check /> Finish sketch</button>
  </div>
}

export function SketchViewControls({ scale, onZoom, onFit, onReset }: {
  scale: number
  onZoom: (factor: number) => void
  onFit: () => void
  onReset: () => void
}) {
  return <>
    <div className="sketch-view-controls">
      <button title="Zoom in" aria-label="Zoom in" onClick={() => onZoom(1.25)}><ZoomIn /></button>
      <span>{Math.round(scale / INITIAL_SCALE * 100)}%</span>
      <button title="Zoom out" aria-label="Zoom out" onClick={() => onZoom(0.8)}><ZoomOut /></button>
      <button title="Fit sketch" aria-label="Fit sketch" onClick={onFit}><Maximize2 /></button>
      <button title="Reset view" aria-label="Reset sketch view" onClick={onReset}><Focus /></button>
    </div>
    <div className="sketch-navigation-hint">Wheel to zoom · Middle-drag or Space-drag to pan</div>
  </>
}

export function ProfileStatus({ regions, holes }: { regions: number; holes: number }) {
  return <div className={`profile-status ${regions ? 'closed' : ''}`}>
    {regions
      ? <><Check /> {regions} region{regions > 1 ? 's' : ''} ready{holes ? ` · ${holes} hole${holes > 1 ? 's' : ''}` : ''}</>
      : <><MousePointer2 /> Draw a closed profile</>}
  </div>
}
