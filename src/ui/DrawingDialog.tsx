import { useEffect, useMemo, useState } from 'react'
import { Download, FileImage, RefreshCw } from 'lucide-react'
import { useDocumentStore } from '../core/document-store'
import { logDiagnostic } from '../core/diagnostics'
import { buildDrawingSheet, hasDrawableGeometry } from '../drawing/build-sheet'
import {
  DRAWING_VIEW_IDS,
  DRAWING_VIEW_LABELS,
  ORTHOGRAPHIC_VIEW_IDS,
  SHEET_SIZES,
  type DrawingOptions,
  type DrawingViewId,
  type OrthographicViewId,
  type ProjectedView,
} from '../drawing/drawing-types'
import { renderSheetToPdf } from '../drawing/pdf-renderer'
import { renderSheetToSvg } from '../drawing/svg-renderer'
import { STANDARD_SCALES, formatScale } from '../drawing/sheet-format'
import { projectExactDocument } from '../kernel/exact-kernel'
import { DialogShell } from './ProjectDialogs'
import { downloadBlob, fileStem } from './download'

type ProjectionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; views: ProjectedView[] }

function Toggle({ label, checked, onChange, disabled }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="drawing-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function DrawingDialog({ onClose }: { onClose: () => void }) {
  const document = useDocumentStore((state) => state.document)
  const displayUnits = document.displayUnits ?? 'mm'

  const [projection, setProjection] = useState<ProjectionState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const [options, setOptions] = useState<DrawingOptions>({
    // A dimensioned multi-view set needs more paper than Letter before the
    // scale starts collapsing; the smaller sizes stay one click away.
    sheetSizeId: 'tabloid',
    views: ['front', 'top', 'right', 'iso'],
    showHiddenLines: true,
    showDimensions: true,
    showCenterMarks: true,
    showParameterTable: true,
    section: { enabled: false, parent: 'front', position: 0.5 },
    scale: null,
    title: {
      partName: document.name,
      drawnBy: '',
      material: '',
      finish: '',
      notes: [],
    },
  })
  const [notesDraft, setNotesDraft] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)

  // Every view is projected once, with hidden lines, and most option toggles
  // then filter what is drawn. Turning off a view or its dashed lines is a
  // presentation choice and should never send the user back to the kernel.
  //
  // Where the section is cut is the exception: it changes the solid, so it has
  // to be re-evaluated. It is kept out of the dependencies until the section is
  // switched on, so dragging the position slider costs nothing while it is off.
  const sectionKey = options.section.enabled
    ? `${options.section.parent}:${options.section.position}`
    : 'none'

  useEffect(() => {
    let cancelled = false
    setProjection({ status: 'loading' })
    const [parent, position] = sectionKey === 'none' ? [] : sectionKey.split(':')
    projectExactDocument(document.features, {
      views: [...DRAWING_VIEW_IDS],
      hiddenLines: true,
      section: parent ? { parent: parent as OrthographicViewId, position: Number(position), label: 'A' } : undefined,
    })
      .then((result) => {
        if (cancelled) return
        if (!hasDrawableGeometry(result.views)) {
          setProjection({ status: 'error', message: 'The model produced no geometry to draw.' })
          return
        }
        setProjection({ status: 'ready', views: result.views })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'The exact kernel could not project this model.'
        logDiagnostic('error', 'Drawing projection', message)
        setProjection({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [document.features, reloadToken, sectionKey])

  const built = useMemo(() => {
    if (projection.status !== 'ready') return null
    const notes = notesDraft.split('\n').map((note) => note.trim()).filter(Boolean)
    return buildDrawingSheet({
      views: projection.views,
      features: document.features,
      displayUnits,
      parameters: document.parameters,
      options: { ...options, title: { ...options.title, notes } },
      date: new Date(),
    })
  }, [projection, options, notesDraft, document.features, document.parameters, displayUnits])

  const svg = useMemo(() => (built ? renderSheetToSvg(built.sheet) : null), [built])
  const previewSource = useMemo(
    () => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null),
    [svg],
  )

  function patch(changes: Partial<DrawingOptions>) {
    setOptions((current) => ({ ...current, ...changes }))
  }

  function toggleView(id: DrawingViewId, enabled: boolean) {
    // Keep the stored order canonical so the layout is stable no matter which
    // order the boxes were ticked in.
    const next = DRAWING_VIEW_IDS.filter((candidate) =>
      candidate === id ? enabled : options.views.includes(candidate))
    patch({ views: next })
  }

  function exportSheet(format: 'pdf' | 'svg') {
    if (!built || !svg) return
    setExportError(null)
    try {
      const stem = `${fileStem(document.name)}-drawing`
      if (format === 'svg') {
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${stem}.svg`)
        return
      }
      const bytes = renderSheetToPdf(built.sheet)
      downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), `${stem}.pdf`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The drawing could not be exported.'
      logDiagnostic('error', 'Drawing export', message)
      setExportError(message)
    }
  }

  const aspect = built ? built.sheet.width / built.sheet.height : 297 / 210

  return (
    <DialogShell title="Drawing sheet" onClose={onClose} wide>
      <div className="drawing-dialog">
        <div className="drawing-preview" style={{ aspectRatio: aspect }}>
          {projection.status === 'loading' && <p className="drawing-status">Projecting views…</p>}
          {projection.status === 'error' && (
            <div className="drawing-status error">
              <p>{projection.message}</p>
              <button onClick={() => setReloadToken((token) => token + 1)}><RefreshCw size={12} /> Try again</button>
            </div>
          )}
          {previewSource && <img src={previewSource} alt="Drawing sheet preview" />}
        </div>

        <div className="drawing-controls">
          <label className="drawing-field">
            <span>Sheet</span>
            <select value={options.sheetSizeId} onChange={(event) => patch({ sheetSizeId: event.target.value })}>
              {SHEET_SIZES.map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
            </select>
          </label>

          <label className="drawing-field">
            <span>Scale</span>
            <select
              value={options.scale === null ? 'auto' : String(options.scale)}
              onChange={(event) => patch({ scale: event.target.value === 'auto' ? null : Number(event.target.value) })}
            >
              <option value="auto">Fit to sheet{built ? ` · ${formatScale(built.scale)}` : ''}</option>
              {STANDARD_SCALES.map((scale) => (
                <option key={scale} value={scale}>{formatScale(scale)}</option>
              ))}
            </select>
          </label>

          <div className="drawing-field">
            <span>Views</span>
            <div className="drawing-checks">
              {DRAWING_VIEW_IDS.map((id) => (
                <Toggle
                  key={id}
                  label={DRAWING_VIEW_LABELS[id]}
                  checked={options.views.includes(id)}
                  disabled={options.views.length === 1 && options.views.includes(id)}
                  onChange={(checked) => toggleView(id, checked)}
                />
              ))}
            </div>
          </div>

          <div className="drawing-field">
            <span>Annotation</span>
            <div className="drawing-checks">
              <Toggle label="Dimensions" checked={options.showDimensions} onChange={(v) => patch({ showDimensions: v })} />
              <Toggle label="Hidden lines" checked={options.showHiddenLines} onChange={(v) => patch({ showHiddenLines: v })} />
              <Toggle label="Center marks" checked={options.showCenterMarks} onChange={(v) => patch({ showCenterMarks: v })} />
              <Toggle label="Parameters" checked={options.showParameterTable} onChange={(v) => patch({ showParameterTable: v })} />
            </div>
          </div>

          <div className="drawing-field">
            <span>Section</span>
            <Toggle
              label="Cut a section view"
              checked={options.section.enabled}
              onChange={(enabled) => patch({ section: { ...options.section, enabled } })}
            />
            {options.section.enabled && (
              <>
                <select
                  aria-label="Section direction"
                  value={options.section.parent}
                  onChange={(event) =>
                    patch({ section: { ...options.section, parent: event.target.value as OrthographicViewId } })}
                >
                  {ORTHOGRAPHIC_VIEW_IDS.map((id) => (
                    <option key={id} value={id}>Cut in place of {DRAWING_VIEW_LABELS[id].toLowerCase()}</option>
                  ))}
                </select>
                <label className="drawing-slider">
                  <input
                    type="range"
                    aria-label="Section position"
                    min={0.05}
                    max={0.95}
                    step={0.05}
                    value={options.section.position}
                    onChange={(event) =>
                      patch({ section: { ...options.section, position: Number(event.target.value) } })}
                  />
                  <output>{Math.round(options.section.position * 100)}%</output>
                </label>
                <small>The section replaces its view and is hatched where the cut meets material.</small>
              </>
            )}
          </div>

          <label className="drawing-field">
            <span>Part name</span>
            <input
              value={options.title.partName}
              onChange={(event) => patch({ title: { ...options.title, partName: event.target.value } })}
            />
          </label>

          <div className="drawing-field drawing-field-pair">
            <span>Material</span>
            <input
              placeholder="e.g. 6061-T6"
              value={options.title.material}
              onChange={(event) => patch({ title: { ...options.title, material: event.target.value } })}
            />
            <input
              placeholder="Finish"
              value={options.title.finish}
              onChange={(event) => patch({ title: { ...options.title, finish: event.target.value } })}
            />
          </div>

          <label className="drawing-field">
            <span>Drawn by</span>
            <input
              placeholder="Your name"
              value={options.title.drawnBy}
              onChange={(event) => patch({ title: { ...options.title, drawnBy: event.target.value } })}
            />
          </label>

          <label className="drawing-field">
            <span>Notes</span>
            <textarea
              rows={3}
              placeholder="One note per line"
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
            />
          </label>

          {built && built.emptyViews.length > 0 && (
            <p className="drawing-warning">No geometry projected into: {built.emptyViews.join(', ')}.</p>
          )}
          {exportError && <p className="drawing-warning error">{exportError}</p>}

          <div className="export-actions drawing-actions">
            <button disabled={!built} onClick={() => exportSheet('pdf')}><Download size={13} /> Export PDF</button>
            <button disabled={!built} onClick={() => exportSheet('svg')}><FileImage size={13} /> Export SVG</button>
          </div>
          <small className="drawing-hint">
            Dimensions are generated from the model geometry as a starting point. Check them against your design intent
            before releasing the drawing.
          </small>
        </div>
      </div>
    </DialogShell>
  )
}
