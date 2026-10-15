import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { LineEntity, Vec2 } from '../core/model'
import { useDocumentStore } from '../core/document-store'
import {
  connectedSketchEntityIds,
  getProfileRegions,
  sketchEntitySelectionCenter,
} from '../core/sketch'
import { parseLengthInput, sketchSnapIncrement } from '../core/units'
import { useConstraintSolverStore } from './constraint-solver'
import { ConstraintPanel } from './ConstraintPanel'
import { sketchConstraintState } from './constraint-state'
import { applySketchFillet, applySketchGeometry, applySketchTrim } from './sketch-edits'
import { reverseLineRuler, type LineRuler } from './entity-snap'
import {
  beginAngleBreakaway,
  inferredLineAngle,
  snapLineEnd,
  updateAngleBreakaway,
  type AngleBreakawayState,
} from './line-inference'
import { tangentSourceAtPoint, type TangentArcSource } from './tangent-arc'
import { pickTrimTarget, trimRemovalPreview } from './trim'
import { screenToModel } from './sketch-view'
import { screenMap } from './sketch-screen'
import { toolForKey, type AngleSnap } from './sketch-tools'
import { useSketchDrags } from './use-sketch-drags'
import {
  centrePointArcGeometry,
  circleGeometry,
  distance,
  lineGeometry,
  rectangleGeometry,
  tangentArcGeometry,
  threePointArcGeometry,
  type ActiveSnap,
  type GeometryAddition,
} from './sketch-geometry-builders'
import { resolveSketchPoint, type ResolvedPoint } from './sketch-point-resolution'
import { sketchReadout } from './sketch-readout'
import { drawingPreview } from './sketch-drawing-preview'
import { useSketchView } from './use-sketch-view'
import { useViewportStore } from '../viewport/viewport-store'
import {
  DrawingPreview,
  FaceReferenceGeometry,
  LineRulerOverlay,
  SketchEntityLayer,
  SketchGrid,
  SnapIndicator,
} from './SketchSurfaceLayers'
import {
  FaceReferencePanel,
  LineEndpointPanel,
  PositionPanel,
  ProfileStatus,
  SketchBanner,
  SketchToolbar,
  SketchViewControls,
  SolverBadge,
} from './SketchPanels'

/**
 * How near the pointer has to be to a curve to trim it, in screen pixels.
 *
 * Screen-space rather than model-space, so the tool feels the same at every zoom
 * level; it is divided by the view scale at the point of use.
 */
const TRIM_PICK_TOLERANCE_PX = 8

/**
 * A centre-point arc that has its centre and radius but not yet its sweep.
 *
 * `start` is a point on the arc, not an angle, so the preview and the committed
 * entity are both derived from the same two clicks.
 */
type PendingArc = {
  center: Vec2
  start: Vec2
}

type PendingThreePointArc = { start: Vec2; end?: Vec2 }

function capturePointer(element: Element | null | undefined, pointerId: number) {
  try {
    element?.setPointerCapture(pointerId)
  } catch {
    // Synthetic automation events do not have an active native pointer.
  }
}

export function SketchEditor({ sketchId }: { sketchId: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const angleBreakawayRef = useRef<AngleBreakawayState | null>(null)
  const fineAngleControlRef = useRef(false)
  const spacePressedRef = useRef(false)
  const feature = useDocumentStore((state) => state.document.features.find((candidate) => candidate.id === sketchId))
  const sketch = feature?.kind === 'sketch' ? feature : undefined
  const displayUnits = useDocumentStore((state) => state.document.displayUnits ?? 'mm')
  const projectedReferences = useViewportStore((state) => state.projectedReferences)
  const sketchSnap = sketchSnapIncrement(displayUnits)
  const tool = useDocumentStore((state) => state.sketchTool)
  const solver = useConstraintSolverStore()
  const constraintState = sketchConstraintState(solver)
  const { view, setView, size, onWheel, zoom, reset, fit } = useSketchView(svgRef, sketch)
  const drags = useSketchDrags(sketchId, setView, sketchSnap)
  const cancelDrags = drags.cancel
  const [start, setStart] = useState<Vec2 | null>(null)
  const [startSnap, setStartSnap] = useState<ActiveSnap | null>(null)
  /** A centre-point arc between its second and third click. */
  const [pendingArc, setPendingArc] = useState<PendingArc | null>(null)
  const [pendingThreePointArc, setPendingThreePointArc] = useState<PendingThreePointArc | null>(null)
  const [pendingTangentArc, setPendingTangentArc] = useState<TangentArcSource | null>(null)
  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [angleSnap, setAngleSnap] = useState<AngleSnap>(0)
  const [fineAngleControl, setFineAngleControl] = useState(false)
  /**
   * Selected geometry, oldest first.
   *
   * A list rather than a single id because a relationship needs two things to
   * relate. Everything that worked on one entity keeps working on the most
   * recent of these, so ordinary single-click selection is unchanged.
   */
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([])
  /** Geometry lit up because the pointer is over its constraint in the list. */
  const [hoveredConstraintEntityIds, setHoveredConstraintEntityIds] = useState<string[]>([])
  const [activeSnap, setActiveSnap] = useState<ActiveSnap | null>(null)
  const [activeRuler, setActiveRuler] = useState<LineRuler | null>(null)
  const [rulerDatum, setRulerDatum] = useState<'start' | 'end'>('start')
  /** The span the trim tool would remove, shown under the pointer. */
  const [trimPreview, setTrimPreview] = useState<Vec2[] | null>(null)
  const [filletRadiusDraft, setFilletRadiusDraft] = useState('3')
  const [filletError, setFilletError] = useState<string | null>(null)

  function resetLineGesture() {
    angleBreakawayRef.current = null
    fineAngleControlRef.current = false
    setFineAngleControl(false)
  }

  useEffect(() => {
    if (tool !== 'arc') setPendingArc(null)
    if (tool !== 'three-point-arc') setPendingThreePointArc(null)
    if (tool !== 'tangent-arc') setPendingTangentArc(null)
    if (tool !== 'trim') setTrimPreview(null)
    setStart(null)
    setStartSnap(null)
    setActiveRuler(null)
    resetLineGesture()
  }, [tool])

  const selectedEntityId = selectedEntityIds.at(-1) ?? null
  const setSelectedEntityId = (entityId: string | null) => setSelectedEntityIds(entityId ? [entityId] : [])
  const selectedLine = sketch?.entities.find((entity): entity is LineEntity => entity.id === selectedEntityId && entity.type === 'line') ?? null

  /**
   * The geometry named by whichever constraints the solver could not satisfy.
   *
   * This is the whole point of keeping the solver's constraint ids: a count of
   * conflicts tells a user that something is wrong, and this tells them where.
   */
  const troubledConstraintIds = useMemo(
    () => new Set([...solver.conflicting, ...solver.redundant, ...solver.unsupported]),
    [solver.conflicting, solver.redundant, solver.unsupported],
  )
  const troubledEntityIds = useMemo(() => {
    const ids = new Set(hoveredConstraintEntityIds)
    for (const constraint of sketch?.constraints ?? []) {
      if (troubledConstraintIds.has(constraint.id)) for (const id of constraint.entityIds) ids.add(id)
    }
    return ids
  }, [hoveredConstraintEntityIds, sketch, troubledConstraintIds])

  const regions = useMemo(() => sketch ? getProfileRegions(sketch) : [], [sketch])
  const holeCount = useMemo(() => regions.reduce((total, region) => total + region.holes.length, 0), [regions])
  const placementEntityIds = useMemo(() => {
    if (!sketch) return new Set<string>()
    return selectedEntityId
      ? connectedSketchEntityIds(sketch, selectedEntityId)
      : new Set(sketch.entities.map((entity) => entity.id))
  }, [selectedEntityId, sketch])
  const placementCenter = useMemo(() => {
    if (!sketch || !placementEntityIds.size) return null
    return sketchEntitySelectionCenter(sketch.entities, placementEntityIds)
  }, [placementEntityIds, sketch])

  useEffect(() => {
    function isEditingField(event: KeyboardEvent) {
      return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === 'Space' && !isEditingField(event)) {
        spacePressedRef.current = true
        event.preventDefault()
      }
      if (isEditingField(event)) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEntityId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        useDocumentStore.getState().deleteSketchEntity(sketchId, selectedEntityId)
        setSelectedEntityId(null)
        return
      }
      if (event.key === 'Escape') {
        setActiveRuler(null)
        setActiveSnap(null)
        if (cancelDrags()) return
        if (pendingArc) setPendingArc(null)
        else if (pendingThreePointArc) setPendingThreePointArc(null)
        else if (pendingTangentArc) setPendingTangentArc(null)
        else if (start) setStart(null)
        else if (selectedEntityId) setSelectedEntityId(null)
        else useDocumentStore.getState().finishSketch()
      }
      if (event.key === 'Tab' && tool === 'line' && activeRuler) {
        event.preventDefault()
        const reversed = reverseLineRuler(activeRuler)
        setRulerDatum(reversed.datum)
        setActiveRuler(reversed)
        if (reversed.snap) setActiveSnap({ ...reversed.snap, source: 'entity' })
        return
      }
      const shortcut = toolForKey(event.key)
      if (shortcut) useDocumentStore.getState().setSketchTool(shortcut)
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') spacePressedRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [activeRuler, cancelDrags, pendingArc, pendingTangentArc, pendingThreePointArc, selectedEntityId, sketchId, start, tool])

  if (!sketch) return null
  const activeSketch = sketch
  const displayEntities = drags.dragEntities ?? activeSketch.entities

  function modelPointDetails(clientX: number, clientY: number, applySnap = true, excludedEntityId?: string): ResolvedPoint {
    const bounds = svgRef.current!.getBoundingClientRect()
    const point = screenToModel(view, size, [clientX - bounds.left, clientY - bounds.top])
    if (!applySnap) return { point, snap: null, ruler: null }
    return resolveSketchPoint({
      point,
      lines: activeSketch.entities.filter((entity): entity is LineEntity => entity.type === 'line' && entity.id !== excludedEntityId),
      scale: view.scale,
      displayUnits,
      gridIncrement: sketchSnap,
      rulerDatum,
      attachment: activeSketch.attachment,
      projected: projectedReferences,
    })
  }

  function modelPointFromClient(clientX: number, clientY: number, applySnap = true): Vec2 {
    return modelPointDetails(clientX, clientY, applySnap).point
  }

  /** Add what a tool drew. False when the gesture did not describe any geometry. */
  function commitGeometry(addition: GeometryAddition | null) {
    if (!addition) return false
    void applySketchGeometry(sketchId, addition.entities, addition.constraints)
    return true
  }

  function smartAngleTolerance() {
    return fineAngleControlRef.current ? 0.25 : 4
  }

  /** Finish a two-point gesture: a rectangle, circle, or line. */
  function addGeometry(rawEnd: Vec2, endSnap: ActiveSnap | null) {
    if (!start || distance(start, rawEnd) < 0.5) return
    if (tool === 'rectangle') commitGeometry(rectangleGeometry(start, rawEnd))
    else if (tool === 'circle') commitGeometry(circleGeometry(start, rawEnd))
    else if (tool === 'line') {
      // Explicit geometry targets carry design intent and therefore take
      // precedence over the background angle/length grid.
      const end = endSnap ? rawEnd : snapLineEnd(start, rawEnd, angleSnap, sketchSnap, smartAngleTolerance())
      const inferredAngle = inferredLineAngle(start, end, angleSnap, Boolean(endSnap), smartAngleTolerance())
      commitGeometry(lineGeometry(start, end, inferredAngle, startSnap, endSnap))
    }
  }

  function beginLine(result: ResolvedPoint, event: ReactPointerEvent) {
    setStart(result.point)
    setStartSnap(result.snap)
    setCursor(result.point)
    setActiveSnap(result.snap)
    setActiveRuler(result.ruler)
    resetLineGesture()
    angleBreakawayRef.current = beginAngleBreakaway([event.clientX, event.clientY], event.timeStamp)
  }

  function beginEntityDrag(event: ReactPointerEvent<SVGGElement>, entityId: string) {
    if (event.button !== 0 || spacePressedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (tool === 'tangent-arc') {
      const point = modelPointFromClient(event.clientX, event.clientY, pendingTangentArc !== null)
      if (pendingTangentArc) {
        if (commitGeometry(tangentArcGeometry(pendingTangentArc, point))) setPendingTangentArc(null)
      } else {
        const entity = activeSketch.entities.find((candidate) => candidate.id === entityId)
        const source = entity && tangentSourceAtPoint(entity, point, 12 / view.scale)
        if (source) setPendingTangentArc(source)
      }
      setCursor(point)
      return
    }
    if (tool === 'line') {
      // Geometry hit areas sit above the SVG background. While drawing, a
      // press on one is a snap target, not a request to drag that geometry.
      beginLine(modelPointDetails(event.clientX, event.clientY), event)
      capturePointer(svgRef.current, event.pointerId)
      return
    }
    if (tool !== 'select') return
    setStart(null)
    setStartSnap(null)

    // Shift extends the selection so two entities can be related to each other.
    // Clicking an already-selected entity again removes it, which is how a
    // mis-click is undone without starting the selection over.
    if (event.shiftKey) {
      setSelectedEntityIds((current) => current.includes(entityId)
        ? current.filter((id) => id !== entityId)
        : [...current, entityId])
      return
    }
    setSelectedEntityId(entityId)
    const origin = modelPointFromClient(event.clientX, event.clientY, false)
    drags.beginEntityDrag(event.pointerId, origin, activeSketch.entities, connectedSketchEntityIds(activeSketch, entityId))
    capturePointer(svgRef.current, event.pointerId)
  }

  function beginEndpointDrag(event: ReactPointerEvent<SVGCircleElement>, entity: LineEntity, pointRef: 'start' | 'end') {
    if (tool !== 'select' || event.button !== 0 || spacePressedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedEntityId(entity.id)
    drags.beginEndpointDrag(event.pointerId, entity, pointRef, activeSketch.entities)
    capturePointer(svgRef.current, event.pointerId)
  }

  /**
   * Round the corner between the two selected entities.
   *
   * The selection is cleared on success because both lines have been replaced by
   * shorter ones and an arc: keeping the old selection would leave the fillet
   * control offering to round a corner that is already rounded.
   */
  function applyCornerFillet() {
    if (selectedEntityIds.length !== 2) return
    const radius = parseLengthInput(filletRadiusDraft, displayUnits)
    if (radius === null || radius <= 0) {
      setFilletError('Enter a fillet radius greater than zero.')
      return
    }
    void applySketchFillet(sketchId, selectedEntityIds[0], selectedEntityIds[1], radius).then((failure) => {
      setFilletError(failure)
      if (!failure) setSelectedEntityIds([])
    })
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const shouldPan = event.button === 1 || (event.button === 0 && spacePressedRef.current)
    if (shouldPan) {
      event.preventDefault()
      drags.beginPan(event, view)
      capturePointer(event.currentTarget, event.pointerId)
      return
    }
    if (event.button !== 0) return
    const result = modelPointDetails(event.clientX, event.clientY)
    if (tool === 'trim') {
      // The raw pointer position, not the snapped one: snapping pulls a click
      // towards an endpoint or a crossing, and a crossing is exactly the boundary
      // between the two pieces the user is choosing between.
      const raw = modelPointFromClient(event.clientX, event.clientY, false)
      const target = pickTrimTarget(displayEntities, raw, TRIM_PICK_TOLERANCE_PX / view.scale)
      if (target) void applySketchTrim(sketchId, target.id, raw)
      setActiveSnap(null)
      setActiveRuler(null)
      return
    }
    if (tool === 'select') {
      setSelectedEntityId(null)
      setActiveSnap(null)
      setActiveRuler(null)
      return
    }
    if (tool === 'three-point-arc') {
      if (!pendingThreePointArc) setPendingThreePointArc({ start: result.point })
      else if (!pendingThreePointArc.end) {
        if (distance(pendingThreePointArc.start, result.point) >= 0.5) setPendingThreePointArc({ ...pendingThreePointArc, end: result.point })
      } else if (commitGeometry(threePointArcGeometry(pendingThreePointArc.start, pendingThreePointArc.end, result.point))) {
        setPendingThreePointArc(null)
      }
    } else if (tool === 'tangent-arc') {
      if (pendingTangentArc && commitGeometry(tangentArcGeometry(pendingTangentArc, result.point))) setPendingTangentArc(null)
    } else if (tool === 'arc') {
      // Centre-point arc is deliberately three clicks, matching the toolbar:
      // centre, start/radius, end/sweep. The old first-click-and-drag gesture
      // looked like the circle tool and made an unchanged final direction turn
      // into a visually indistinguishable full circle.
      if (pendingArc) {
        if (commitGeometry(centrePointArcGeometry(pendingArc.center, pendingArc.start, result.point))) setPendingArc(null)
      } else if (start) {
        if (distance(start, result.point) >= 0.5) {
          setPendingArc({ center: start, start: result.point })
          setStart(null)
        }
      } else {
        setStart(result.point)
      }
    } else if (tool === 'line') {
      beginLine(result, event)
    } else {
      setStart(result.point)
      setStartSnap(null)
      setActiveRuler(null)
    }
    setCursor(result.point)
    setActiveSnap(tool === 'arc' ? null : result.snap)
    capturePointer(event.currentTarget, event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const dragged = drags.move(event, (applySnap, excluded) => modelPointDetails(event.clientX, event.clientY, applySnap, excluded))
    if (dragged) {
      if (dragged !== 'pan') {
        setCursor(dragged.cursor)
        setActiveSnap(dragged.snap)
      }
      return
    }
    if (tool === 'trim') {
      // Trim is destructive and its result depends on geometry the user cannot
      // see — where the crossings are — so the span that would go is drawn
      // before the click rather than explained after it.
      const raw = modelPointFromClient(event.clientX, event.clientY, false)
      const target = pickTrimTarget(displayEntities, raw, TRIM_PICK_TOLERANCE_PX / view.scale)
      setTrimPreview(target ? trimRemovalPreview(displayEntities, target.id, raw) : null)
      setCursor(raw)
      setActiveSnap(null)
      setActiveRuler(null)
      return
    }
    const result = modelPointDetails(event.clientX, event.clientY)
    if (tool === 'line' && start && angleSnap === 0 && !result.snap && angleBreakawayRef.current) {
      angleBreakawayRef.current = updateAngleBreakaway(
        angleBreakawayRef.current,
        start,
        result.point,
        [event.clientX, event.clientY],
        event.timeStamp,
      )
      const fine = angleBreakawayRef.current.fine
      fineAngleControlRef.current = fine
      setFineAngleControl(fine)
    }
    setCursor(result.point)
    setActiveSnap(result.snap)
    setActiveRuler(tool === 'line' ? result.ruler : null)
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (drags.end(event.pointerId)) {
      setActiveSnap(null)
      setActiveRuler(null)
      return
    }
    // Centre-point arcs advance on discrete pointer-down clicks; pointer-up
    // must not clear the centre selected by the first click.
    if (tool === 'arc') return
    if (!start) return
    const result = modelPointDetails(event.clientX, event.clientY)
    addGeometry(result.point, result.snap)
    setStart(null)
    setStartSnap(null)
    setActiveSnap(null)
    setActiveRuler(null)
    resetLineGesture()
  }

  function onPointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    drags.cancel(event.pointerId)
    setStart(null)
    setStartSnap(null)
    setActiveRuler(null)
  }

  const screen = screenMap(view, size)
  const preview = drawingPreview({
    tool,
    start,
    cursor,
    snapped: activeSnap !== null,
    angleSnap,
    gridIncrement: sketchSnap,
    angleTolerance: fineAngleControl ? 0.25 : 4,
    trimPreview,
    pendingArc,
    pendingThreePointArc,
    pendingTangentArc,
  })
  const readout = sketchReadout(preview, displayUnits)
  const entityClassName = (entityId: string) => [
    constraintState,
    selectedEntityIds.includes(entityId) ? 'selected' : '',
    troubledEntityIds.has(entityId) ? 'constraint-trouble' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="sketch-editor">
      <svg
        ref={svgRef}
        className={`sketch-surface${drags.isPanning ? ' panning' : ''}${tool === 'select' ? ' selecting' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <SketchGrid screen={screen} size={size} units={displayUnits} />
        {activeSketch.attachment && <FaceReferenceGeometry attachment={activeSketch.attachment} screen={screen} />}
        {tool === 'line' && activeRuler && <LineRulerOverlay ruler={activeRuler} units={displayUnits} screen={screen} />}
        {activeSnap && <SnapIndicator snap={activeSnap} screen={screen} />}
        <SketchEntityLayer
          entities={displayEntities}
          constraints={activeSketch.constraints}
          screen={screen}
          units={displayUnits}
          classNameFor={entityClassName}
          showEndpointHandles={tool === 'select'}
          onEntityPointerDown={beginEntityDrag}
          onEndpointPointerDown={beginEndpointDrag}
        />
        <DrawingPreview state={preview} screen={screen} />
      </svg>

      <SketchBanner sketch={activeSketch} units={displayUnits} />
      <SolverBadge solver={solver} />
      {activeSketch.attachment && <FaceReferencePanel attachment={activeSketch.attachment} units={displayUnits} />}
      <ConstraintPanel
        sketch={activeSketch}
        selectedEntityIds={selectedEntityIds}
        conflicting={solver.conflicting}
        redundant={solver.redundant}
        unsupported={solver.unsupported}
        displayUnits={displayUnits}
        onHighlight={setHoveredConstraintEntityIds}
      />
      {selectedLine && <LineEndpointPanel sketchId={sketchId} line={selectedLine} units={displayUnits} />}
      {placementCenter && (
        <PositionPanel
          sketchId={sketchId}
          center={placementCenter}
          entityIds={placementEntityIds}
          hasSelection={selectedEntityId !== null}
          attachment={activeSketch.attachment}
          besideLineEndpoints={selectedLine !== null}
          units={displayUnits}
        />
      )}
      <SketchToolbar
        tool={tool}
        angleSnap={angleSnap}
        onAngleSnap={setAngleSnap}
        fillet={selectedEntityIds.length === 2 ? {
          draft: filletRadiusDraft,
          onDraft: (value) => { setFilletRadiusDraft(value); setFilletError(null) },
          onApply: applyCornerFillet,
        } : null}
        onUndo={() => { useDocumentStore.getState().undo(); setStart(null) }}
        onDelete={selectedEntityId ? () => { useDocumentStore.getState().deleteSketchEntity(sketchId, selectedEntityId); setSelectedEntityId(null) } : null}
      />
      <SketchViewControls scale={view.scale} onZoom={zoom} onFit={fit} onReset={reset} />
      {filletError && <div className="selection-status invalid">{filletError}</div>}
      {!filletError && selectedEntityIds.length === 2 && <div className="selection-status">Two entities selected · set a radius and apply to round the corner</div>}
      {!filletError && selectedEntityIds.length !== 2 && selectedEntityId && <div className="selection-status">Selected geometry · drag endpoints or body · Delete to remove</div>}
      <ProfileStatus regions={regions.length} holes={holeCount} />
      {readout && <div className="cursor-coordinate">{readout}</div>}
    </div>
  )
}
