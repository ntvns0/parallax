import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
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
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { createId, type ArcEntity, type DisplayUnits, type LineEntity, type SketchConstraint, type SketchEntity, type Vec2 } from '../core/model'
import { arcEndPoint, arcFromCenterAndPoints, arcFromThreePoints, arcPointAt, arcStartPoint, tangentArcFromEndpoint, type ArcLike } from '../core/arc-geometry'
import { useDocumentStore } from '../core/document-store'
import { snapToFaceReference, type FaceSnap } from '../core/face-reference'
import {
  connectedSketchEntityIds,
  getProfileRegions,
  sketchBounds,
  sketchEntitySelectionCenter,
  translateSketchEntities,
} from '../core/sketch'
import { formatLength, formatLengthInput, parseLengthInput, sketchSnapIncrement, unitLabel } from '../core/units'
import { useConstraintSolverStore } from './constraint-solver'
import { ConstraintPanel } from './ConstraintPanel'
import { sketchConstraintState } from './constraint-state'
import { applySketchFillet, applySketchGeometry, applySketchPointPosition, applySketchPosition, applySketchTranslation, applySketchTrim } from './sketch-edits'
import {
  lineRulerAtPoint,
  reverseLineRuler,
  snapToSketchLines,
  type LineRuler,
  type SketchEntitySnap,
} from './entity-snap'
import {
  beginAngleBreakaway,
  inferredLineAngle,
  snapLineEnd,
  updateAngleBreakaway,
  type AngleBreakawayState,
} from './line-inference'
import { tangentSourceAtPoint, type TangentArcSource } from './tangent-arc'
import { pickTrimTarget, trimRemovalPreview } from './trim'
import {
  INITIAL_SCALE,
  frameBounds,
  modelToScreen,
  screenToModel,
  zoomAtCenter,
  zoomAtScreenPoint,
  type SketchView,
} from './sketch-view'

/**
 * How near the pointer has to be to a curve to trim it, in screen pixels.
 *
 * Screen-space rather than model-space, so the tool feels the same at every zoom
 * level; it is divided by the view scale at the point of use.
 */
const TRIM_PICK_TOLERANCE_PX = 8

/** The sketch tools, as the document store names them. */
type EditorTool = ReturnType<typeof useDocumentStore.getState>['sketchTool']

type PanDrag = {
  pointerId: number
  clientX: number
  clientY: number
  panX: number
  panY: number
}

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

type EntityDrag = {
  pointerId: number
  start: Vec2
  source: SketchEntity[]
  preview: SketchEntity[]
  entityIds: Set<string>
  /** Total offset from the drag origin, replayed through the solver on release. */
  delta: Vec2
  moved: boolean
}

type EndpointDrag = {
  pointerId: number
  entityId: string
  pointRef: 'start' | 'end'
  source: SketchEntity[]
  target: Vec2
  moved: boolean
}

type ActiveSnap = ({ source: 'entity' } & SketchEntitySnap) | ({ source: 'face' } & FaceSnap)

function snap(value: number, increment = 1) {
  return Math.round(value / increment) * increment
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function lineAngle(start: Vec2, end: Vec2) {
  return Math.atan2(end[1] - start[1], end[0] - start[0])
}

function normalizeDegrees(radians: number) {
  let degrees = radians * 180 / Math.PI
  while (degrees > 180) degrees -= 360
  while (degrees <= -180) degrees += 360
  return degrees
}

/** Keep labelled ruler divisions readable as the view zooms in and out. */
function adaptiveRulerMultiplier(baseSpacingPixels: number) {
  const minimum = 36
  if (baseSpacingPixels >= minimum) return 1
  const required = minimum / Math.max(baseSpacingPixels, 1e-9)
  let decade = 1
  while (decade * 10 < required) decade *= 10
  for (const step of [1, 2, 5, 10]) {
    const multiplier = decade * step
    if (multiplier >= required) return multiplier
  }
  return decade * 10
}

export function SketchEditor({ sketchId }: { sketchId: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const panDragRef = useRef<PanDrag | null>(null)
  const entityDragRef = useRef<EntityDrag | null>(null)
  const endpointDragRef = useRef<EndpointDrag | null>(null)
  const angleBreakawayRef = useRef<AngleBreakawayState | null>(null)
  const fineAngleControlRef = useRef(false)
  const skipPositionCommitRef = useRef(false)
  const spacePressedRef = useRef(false)
  const sketch = useDocumentStore((state) => state.document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch'))
  const displayUnits = useDocumentStore((state) => state.document.displayUnits ?? 'mm')
  const sketchSnap = sketchSnapIncrement(displayUnits)
  const tool = useDocumentStore((state) => state.sketchTool)
  const solver = useConstraintSolverStore()
  const constraintState = sketchConstraintState(solver)
  const [start, setStart] = useState<Vec2 | null>(null)
  const [startSnap, setStartSnap] = useState<ActiveSnap | null>(null)
  /** A centre-point arc between its second and third click. */
  const [pendingArc, setPendingArc] = useState<PendingArc | null>(null)
  const [pendingThreePointArc, setPendingThreePointArc] = useState<PendingThreePointArc | null>(null)
  const [pendingTangentArc, setPendingTangentArc] = useState<TangentArcSource | null>(null)
  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [angleSnap, setAngleSnap] = useState<0 | 15 | 30 | 45>(0)
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
  const [dragEntities, setDragEntities] = useState<SketchEntity[] | null>(null)
  const [activeSnap, setActiveSnap] = useState<ActiveSnap | null>(null)
  const [activeRuler, setActiveRuler] = useState<LineRuler | null>(null)
  const [rulerDatum, setRulerDatum] = useState<'start' | 'end'>('start')
  const [positionDraft, setPositionDraft] = useState<[string, string]>(['0', '0'])
  /** The span the trim tool would remove, shown under the pointer. */
  const [trimPreview, setTrimPreview] = useState<Vec2[] | null>(null)
  const [filletRadiusDraft, setFilletRadiusDraft] = useState('3')
  const [filletError, setFilletError] = useState<string | null>(null)
  const [endpointDraft, setEndpointDraft] = useState<[string, string, string, string]>(['0', '0', '0', '0'])

  useEffect(() => {
    if (tool !== 'arc') setPendingArc(null)
    if (tool !== 'three-point-arc') setPendingThreePointArc(null)
    if (tool !== 'tangent-arc') setPendingTangentArc(null)
    if (tool !== 'trim') setTrimPreview(null)
    setStart(null)
    setStartSnap(null)
    setActiveRuler(null)
    angleBreakawayRef.current = null
    fineAngleControlRef.current = false
    setFineAngleControl(false)
  }, [tool])
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [view, setView] = useState<SketchView>(() => ({
    scale: INITIAL_SCALE,
    panX: sketch?.kind === 'sketch' && sketch.attachment ? -sketch.attachment.center[0] * INITIAL_SCALE : 0,
    panY: sketch?.kind === 'sketch' && sketch.attachment ? sketch.attachment.center[1] * INITIAL_SCALE : 0,
  }))

  const selectedEntityId = selectedEntityIds.at(-1) ?? null
  const setSelectedEntityId = (entityId: string | null) => setSelectedEntityIds(entityId ? [entityId] : [])
  const selectedLine = sketch?.kind === 'sketch'
    ? sketch.entities.find((entity): entity is LineEntity => entity.id === selectedEntityId && entity.type === 'line') ?? null
    : null

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
    if (sketch?.kind !== 'sketch') return new Set<string>()
    const ids = new Set(hoveredConstraintEntityIds)
    for (const constraint of sketch.constraints) {
      if (troubledConstraintIds.has(constraint.id)) for (const id of constraint.entityIds) ids.add(id)
    }
    return ids
  }, [hoveredConstraintEntityIds, sketch, troubledConstraintIds])

  const regions = useMemo(() => sketch?.kind === 'sketch' ? getProfileRegions(sketch) : [], [sketch])
  const holeCount = useMemo(() => regions.reduce((total, region) => total + region.holes.length, 0), [regions])
  const placementEntityIds = useMemo(() => {
    if (!sketch || sketch.kind !== 'sketch') return new Set<string>()
    return selectedEntityId
      ? connectedSketchEntityIds(sketch, selectedEntityId)
      : new Set(sketch.entities.map((entity) => entity.id))
  }, [selectedEntityId, sketch])
  const placementCenter = useMemo(() => {
    if (!sketch || sketch.kind !== 'sketch' || !placementEntityIds.size) return null
    return sketchEntitySelectionCenter(sketch.entities, placementEntityIds)
  }, [placementEntityIds, sketch])

  useEffect(() => {
    if (!placementCenter) return
    setPositionDraft([formatLengthInput(placementCenter[0], displayUnits), formatLengthInput(placementCenter[1], displayUnits)])
  }, [displayUnits, placementCenter, selectedEntityId])

  useEffect(() => {
    if (!selectedLine) return
    setEndpointDraft([
      formatLengthInput(selectedLine.start[0], displayUnits),
      formatLengthInput(selectedLine.start[1], displayUnits),
      formatLengthInput(selectedLine.end[0], displayUnits),
      formatLengthInput(selectedLine.end[1], displayUnits),
    ])
  }, [displayUnits, selectedLine])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(svg)
    const bounds = svg.getBoundingClientRect()
    setSize({ width: bounds.width, height: bounds.height })
    return () => observer.disconnect()
  }, [])

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
        if (endpointDragRef.current) {
          endpointDragRef.current = null
          setDragEntities(null)
          setActiveSnap(null)
        } else if (entityDragRef.current) {
          entityDragRef.current = null
          setDragEntities(null)
        } else if (pendingArc) setPendingArc(null)
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
      if (event.key.toLowerCase() === 'v') useDocumentStore.getState().setSketchTool('select')
      if (event.key.toLowerCase() === 'l') useDocumentStore.getState().setSketchTool('line')
      if (event.key.toLowerCase() === 'r') useDocumentStore.getState().setSketchTool('rectangle')
      if (event.key.toLowerCase() === 'c') useDocumentStore.getState().setSketchTool('circle')
      if (event.key.toLowerCase() === 'a') useDocumentStore.getState().setSketchTool('arc')
      if (event.key.toLowerCase() === 'g') useDocumentStore.getState().setSketchTool('three-point-arc')
      if (event.key.toLowerCase() === 't') useDocumentStore.getState().setSketchTool('tangent-arc')
      if (event.key.toLowerCase() === 'x') useDocumentStore.getState().setSketchTool('trim')
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
  }, [activeRuler, pendingArc, pendingTangentArc, pendingThreePointArc, selectedEntityId, sketchId, start, tool])

  if (!sketch || sketch.kind !== 'sketch') return null
  const activeSketch = sketch
  const displayEntities = dragEntities ?? activeSketch.entities

  function modelPointDetails(clientX: number, clientY: number, applySnap = true, excludedEntityId?: string) {
    const bounds = svgRef.current!.getBoundingClientRect()
    const point = screenToModel(view, size, [clientX - bounds.left, clientY - bounds.top])
    if (!applySnap) return { point, snap: null, ruler: null }
    const lines = activeSketch.entities.filter((entity): entity is LineEntity =>
      entity.type === 'line' && entity.id !== excludedEntityId)
    const baseMajorIncrement = displayUnits === 'mm' ? 10 : 25.4
    const rulerMultiplier = adaptiveRulerMultiplier(baseMajorIncrement * view.scale)
    const majorIncrement = baseMajorIncrement * rulerMultiplier
    const minorIncrement = displayUnits === 'in-fractional'
      ? 25.4 / 16 * rulerMultiplier
      : majorIncrement / 10
    const ruler = lineRulerAtPoint(
      point,
      lines,
      10 / view.scale,
      6 / view.scale,
      majorIncrement,
      minorIncrement,
      rulerDatum,
    )
    const lineSnap = snapToSketchLines(point, lines, 10 / view.scale)
    if (lineSnap && lineSnap.kind !== 'line') {
      return { point: lineSnap.point, snap: { ...lineSnap, source: 'entity' } as ActiveSnap, ruler }
    }
    if (ruler?.snap) {
      return { point: ruler.snap.point, snap: { ...ruler.snap, source: 'entity' } as ActiveSnap, ruler }
    }
    if (lineSnap) return { point: lineSnap.point, snap: { ...lineSnap, source: 'entity' } as ActiveSnap, ruler }
    const faceSnap = snapToFaceReference(point, activeSketch.attachment, 10 / view.scale)
    return {
      point: faceSnap?.point ?? [snap(point[0], sketchSnap), snap(point[1], sketchSnap)] as Vec2,
      snap: faceSnap ? { ...faceSnap, source: 'face' } as ActiveSnap : null,
      ruler,
    }
  }

  function modelPointFromClient(clientX: number, clientY: number, applySnap = true): Vec2 {
    return modelPointDetails(clientX, clientY, applySnap).point
  }

  function addSnapConstraints(
    constraints: SketchConstraint[],
    entityId: string,
    pointRef: 'start' | 'end',
    target: ActiveSnap | null,
  ) {
    if (!target || target.source !== 'entity') return
    if (target.kind === 'endpoint' && target.pointRef) {
      constraints.push({
        id: createId(),
        type: 'coincident',
        entityIds: [entityId, target.entityIds[0]],
        pointRefs: [pointRef, target.pointRef],
      })
      return
    }
    if (target.kind === 'midpoint') {
      constraints.push({
        id: createId(),
        type: 'midpoint',
        entityIds: [entityId, target.entityIds[0]],
        pointRefs: [pointRef],
      })
      return
    }
    if (target.kind === 'division' && target.pointRef && target.distance !== undefined) {
      constraints.push(
        {
          id: createId(),
          type: 'pointOnLine',
          entityIds: [entityId, target.entityIds[0]],
          pointRefs: [pointRef],
        },
        {
          id: createId(),
          type: 'pointDistance',
          entityIds: [entityId, target.entityIds[0]],
          pointRefs: [pointRef, target.pointRef],
          value: target.distance,
        },
      )
      return
    }
    for (const targetId of target.entityIds) {
      constraints.push({
        id: createId(),
        type: 'pointOnLine',
        entityIds: [entityId, targetId],
        pointRefs: [pointRef],
      })
    }
  }

  function smartAngleTolerance() {
    return fineAngleControlRef.current ? 0.25 : 4
  }

  function addGeometry(rawEnd: Vec2, endSnap: ActiveSnap | null) {
    if (!start || distance(start, rawEnd) < 0.5) return
    const entities: SketchEntity[] = []
    const constraints: SketchConstraint[] = []

    if (tool === 'rectangle') {
      const corners: Vec2[] = [start, [rawEnd[0], start[1]], rawEnd, [start[0], rawEnd[1]]]
      for (let index = 0; index < 4; index += 1) {
        const line: LineEntity = {
          id: createId(), type: 'line', start: corners[index], end: corners[(index + 1) % 4], construction: false,
        }
        entities.push(line)
        constraints.push({ id: createId(), type: index % 2 === 0 ? 'horizontal' : 'vertical', entityIds: [line.id] })
      }
      constraints.push({ id: createId(), type: 'distance', entityIds: [entities[0].id], value: Math.abs(rawEnd[0] - start[0]) })
      constraints.push({ id: createId(), type: 'distance', entityIds: [entities[1].id], value: Math.abs(rawEnd[1] - start[1]) })
      for (let index = 0; index < 4; index += 1) {
        constraints.push({
          id: createId(),
          type: 'coincident',
          entityIds: [entities[index].id, entities[(index + 1) % 4].id],
          pointRefs: ['end', 'start'],
        })
      }
    } else if (tool === 'circle') {
      const radius = distance(start, rawEnd)
      const entity = { id: createId(), type: 'circle' as const, center: start, radius, construction: false }
      entities.push(entity)
      constraints.push({ id: createId(), type: 'radius', entityIds: [entity.id], value: radius })
    } else if (tool === 'arc' || tool === 'three-point-arc' || tool === 'tangent-arc') {
      return
    } else {
      // Explicit geometry targets carry design intent and therefore take
      // precedence over the background angle/length grid.
      const end = endSnap ? rawEnd : snapLineEnd(start, rawEnd, angleSnap, sketchSnap, smartAngleTolerance())
      const entity: LineEntity = { id: createId(), type: 'line', start, end, construction: false }
      entities.push(entity)
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const inferredAngle = inferredLineAngle(start, end, angleSnap, Boolean(endSnap), smartAngleTolerance())
      if (Math.abs(dy) < 1e-8) constraints.push({ id: createId(), type: 'horizontal', entityIds: [entity.id] })
      else if (Math.abs(dx) < 1e-8) constraints.push({ id: createId(), type: 'vertical', entityIds: [entity.id] })
      else if (inferredAngle !== null) constraints.push({ id: createId(), type: 'angle', entityIds: [entity.id], value: inferredAngle })
      addSnapConstraints(constraints, entity.id, 'start', startSnap)
      addSnapConstraints(constraints, entity.id, 'end', endSnap)
    }

    void applySketchGeometry(sketchId, entities, constraints)
  }

  /**
   * Finish a centre-point arc.
   *
   * The first drag fixes the centre and the radius; this last click only says
   * how far round to sweep, so a stray final click cannot distort the arc.
   */
  function commitArc(pending: PendingArc, sweepTo: Vec2) {
    const arc = arcFromCenterAndPoints(pending.center, pending.start, sweepTo)
    if (!arc) return
    const entity: ArcEntity = {
      id: createId(),
      type: 'arc',
      center: arc.center,
      radius: arc.radius,
      startAngle: arc.startAngle,
      endAngle: arc.endAngle,
      construction: false,
    }
    void applySketchGeometry(sketchId, [entity], [
      { id: createId(), type: 'radius', entityIds: [entity.id], value: arc.radius },
    ])
  }

  function commitThreePointArc(pending: Required<PendingThreePointArc>, through: Vec2) {
    const arc = arcFromThreePoints(pending.start, pending.end, through)
    if (!arc) return false
    const entity: ArcEntity = { id: createId(), type: 'arc', ...arc, construction: false }
    void applySketchGeometry(sketchId, [entity], [
      { id: createId(), type: 'radius', entityIds: [entity.id], value: arc.radius },
    ])
    return true
  }

  function commitTangentArc(source: TangentArcSource, end: Vec2) {
    const arc = tangentArcFromEndpoint(source.point, end, source.tangent)
    if (!arc) return false
    const entity: ArcEntity = {
      id: createId(), type: 'arc', center: arc.center, radius: arc.radius,
      startAngle: arc.startAngle, endAngle: arc.endAngle, construction: false,
    }
    void applySketchGeometry(sketchId, [entity], [
      { id: createId(), type: 'coincident', entityIds: [source.entityId, entity.id], pointRefs: [source.pointRef, arc.joinRef] },
      { id: createId(), type: 'tangent', entityIds: [source.entityId, entity.id] },
      { id: createId(), type: 'radius', entityIds: [entity.id], value: arc.radius },
    ])
    return true
  }

  function beginEntityDrag(event: ReactPointerEvent<SVGGElement>, entityId: string) {
    if (event.button !== 0 || spacePressedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (tool === 'tangent-arc') {
      const point = modelPointFromClient(event.clientX, event.clientY, pendingTangentArc !== null)
      if (pendingTangentArc) {
        if (commitTangentArc(pendingTangentArc, point)) setPendingTangentArc(null)
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
      event.preventDefault()
      event.stopPropagation()
      const result = modelPointDetails(event.clientX, event.clientY)
      setStart(result.point)
      setStartSnap(result.snap)
      setCursor(result.point)
      setActiveSnap(result.snap)
      setActiveRuler(result.ruler)
      angleBreakawayRef.current = beginAngleBreakaway([event.clientX, event.clientY], event.timeStamp)
      fineAngleControlRef.current = false
      setFineAngleControl(false)
      try {
        svgRef.current?.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic automation events do not have an active native pointer.
      }
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
    const source = structuredClone(activeSketch.entities)
    entityDragRef.current = {
      pointerId: event.pointerId,
      start: modelPointFromClient(event.clientX, event.clientY, false),
      source,
      preview: source,
      entityIds: connectedSketchEntityIds(activeSketch, entityId),
      delta: [0, 0],
      moved: false,
    }
    try {
      svgRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic automation events do not have an active native pointer.
    }
  }

  function setLineEndpoint(entities: SketchEntity[], entityId: string, pointRef: 'start' | 'end', point: Vec2) {
    return entities.map((entity) => entity.id === entityId && entity.type === 'line'
      ? { ...entity, [pointRef]: point }
      : entity)
  }

  function beginEndpointDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    entity: LineEntity,
    pointRef: 'start' | 'end',
  ) {
    if (tool !== 'select' || event.button !== 0 || spacePressedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedEntityId(entity.id)
    const source = structuredClone(activeSketch.entities)
    endpointDragRef.current = {
      pointerId: event.pointerId,
      entityId: entity.id,
      pointRef,
      source,
      target: entity[pointRef],
      moved: false,
    }
    try {
      svgRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic automation events do not have an active native pointer.
    }
  }

  function capturePointer(event: ReactPointerEvent<SVGSVGElement>) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic automation events do not have an active native pointer.
    }
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
      panDragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        panX: view.panX,
        panY: view.panY,
      }
      setIsPanning(true)
      capturePointer(event)
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
      } else if (commitThreePointArc(pendingThreePointArc as Required<PendingThreePointArc>, result.point)) {
        setPendingThreePointArc(null)
      }
      setCursor(result.point)
      setActiveSnap(result.snap)
      capturePointer(event)
      return
    }
    if (tool === 'tangent-arc') {
      if (pendingTangentArc && commitTangentArc(pendingTangentArc, result.point)) setPendingTangentArc(null)
      setCursor(result.point)
      setActiveSnap(result.snap)
      capturePointer(event)
      return
    }
    if (tool === 'arc') {
      // Centre-point arc is deliberately three clicks, matching the toolbar:
      // centre, start/radius, end/sweep. The old first-click-and-drag gesture
      // looked like the circle tool and made an unchanged final direction turn
      // into a visually indistinguishable full circle.
      if (pendingArc) {
        const arc = arcFromCenterAndPoints(pendingArc.center, pendingArc.start, result.point)
        if (arc) {
          commitArc(pendingArc, result.point)
          setPendingArc(null)
        }
      } else if (start) {
        if (distance(start, result.point) >= 0.5) {
          setPendingArc({ center: start, start: result.point })
          setStart(null)
        }
      } else {
        setStart(result.point)
      }
      setCursor(result.point)
      setActiveSnap(null)
      capturePointer(event)
      return
    }
    setStart(result.point)
    setStartSnap(tool === 'line' ? result.snap : null)
    setCursor(result.point)
    setActiveSnap(result.snap)
    setActiveRuler(tool === 'line' ? result.ruler : null)
    if (tool === 'line') {
      angleBreakawayRef.current = beginAngleBreakaway([event.clientX, event.clientY], event.timeStamp)
      fineAngleControlRef.current = false
      setFineAngleControl(false)
    }
    capturePointer(event)
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const endpointDrag = endpointDragRef.current
    if (endpointDrag?.pointerId === event.pointerId) {
      const result = modelPointDetails(event.clientX, event.clientY, !event.altKey, endpointDrag.entityId)
      endpointDrag.target = result.point
      endpointDrag.moved = distance(
        (endpointDrag.source.find((entity) => entity.id === endpointDrag.entityId) as LineEntity)[endpointDrag.pointRef],
        result.point,
      ) > 1e-9
      setDragEntities(setLineEndpoint(
        endpointDrag.source,
        endpointDrag.entityId,
        endpointDrag.pointRef,
        result.point,
      ))
      setCursor(result.point)
      setActiveSnap(result.snap)
      return
    }
    const entityDrag = entityDragRef.current
    if (entityDrag?.pointerId === event.pointerId) {
      const point = modelPointFromClient(event.clientX, event.clientY, false)
      const delta: Vec2 = [snap(point[0] - entityDrag.start[0], sketchSnap), snap(point[1] - entityDrag.start[1], sketchSnap)]
      const preview = translateSketchEntities(entityDrag.source, entityDrag.entityIds, delta)
      entityDrag.preview = preview
      entityDrag.delta = delta
      entityDrag.moved = delta[0] !== 0 || delta[1] !== 0
      setDragEntities(preview)
      setCursor(point)
      return
    }
    const panDrag = panDragRef.current
    if (panDrag?.pointerId === event.pointerId) {
      setView((current) => ({
        ...current,
        panX: panDrag.panX + event.clientX - panDrag.clientX,
        panY: panDrag.panY + event.clientY - panDrag.clientY,
      }))
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
    const endpointDrag = endpointDragRef.current
    if (endpointDrag?.pointerId === event.pointerId) {
      endpointDragRef.current = null
      setDragEntities(null)
      setActiveSnap(null)
      setActiveRuler(null)
      if (endpointDrag.moved) {
        void applySketchPointPosition(
          sketchId,
          endpointDrag.entityId,
          endpointDrag.pointRef,
          endpointDrag.target,
        )
      }
      return
    }
    const entityDrag = entityDragRef.current
    if (entityDrag?.pointerId === event.pointerId) {
      entityDragRef.current = null
      setDragEntities(null)
      if (entityDrag.moved) void applySketchTranslation(sketchId, entityDrag.entityIds, entityDrag.delta)
      return
    }
    if (panDragRef.current?.pointerId === event.pointerId) {
      panDragRef.current = null
      setIsPanning(false)
      return
    }
    // Centre-point arcs advance on discrete pointer-down clicks; pointer-up
    // must not clear the centre selected by the first click.
    if (tool === 'arc') return
    if (!start) return
    const result = modelPointDetails(event.clientX, event.clientY)
    addGeometry(result.point, result.snap)
    setActiveSnap(result.snap)
    setStart(null)
    setStartSnap(null)
    setActiveSnap(null)
    setActiveRuler(null)
    angleBreakawayRef.current = null
    fineAngleControlRef.current = false
    setFineAngleControl(false)
  }

  function onPointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    if (entityDragRef.current?.pointerId === event.pointerId) {
      entityDragRef.current = null
      setDragEntities(null)
    }
    if (endpointDragRef.current?.pointerId === event.pointerId) {
      endpointDragRef.current = null
      setDragEntities(null)
    }
    if (panDragRef.current?.pointerId === event.pointerId) {
      panDragRef.current = null
      setIsPanning(false)
    }
    setStart(null)
    setStartSnap(null)
    setActiveRuler(null)
  }

  function onWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const offset: Vec2 = [event.clientX - bounds.left, event.clientY - bounds.top]
    const factor = Math.exp(-event.deltaY * 0.0015)
    setView((current) => zoomAtScreenPoint(current, size, offset, factor))
  }

  function zoomFromCenter(factor: number) {
    setView((current) => zoomAtCenter(current, factor))
  }

  function resetView() {
    setView({ scale: INITIAL_SCALE, panX: 0, panY: 0 })
  }

  function commitPosition() {
    if (skipPositionCommitRef.current) {
      skipPositionCommitRef.current = false
      return
    }
    if (!placementCenter) return
    if (positionDraft[0] === formatLengthInput(placementCenter[0], displayUnits)
      && positionDraft[1] === formatLengthInput(placementCenter[1], displayUnits)) return
    const parsed = positionDraft.map((value) => parseLengthInput(value, displayUnits))
    if (parsed.some((value) => value === null)) {
      setPositionDraft([formatLengthInput(placementCenter[0], displayUnits), formatLengthInput(placementCenter[1], displayUnits)])
      return
    }
    const target: Vec2 = parsed as Vec2
    if (Math.abs(target[0] - placementCenter[0]) < 1e-9 && Math.abs(target[1] - placementCenter[1]) < 1e-9) return
    void applySketchPosition(sketchId, placementEntityIds, target)
  }

  function centerAt(target: Vec2) {
    if (!placementCenter) return
    setPositionDraft([formatLengthInput(target[0], displayUnits), formatLengthInput(target[1], displayUnits)])
    void applySketchPosition(sketchId, placementEntityIds, target)
  }

  function commitEndpoint(pointRef: 'start' | 'end') {
    if (!selectedLine) return
    const offset = pointRef === 'start' ? 0 : 2
    const parsed = [
      parseLengthInput(endpointDraft[offset], displayUnits),
      parseLengthInput(endpointDraft[offset + 1], displayUnits),
    ]
    if (parsed.some((value) => value === null)) {
      setEndpointDraft([
        formatLengthInput(selectedLine.start[0], displayUnits),
        formatLengthInput(selectedLine.start[1], displayUnits),
        formatLengthInput(selectedLine.end[0], displayUnits),
        formatLengthInput(selectedLine.end[1], displayUnits),
      ])
      return
    }
    const target = parsed as Vec2
    if (distance(selectedLine[pointRef], target) < 1e-9) return
    void applySketchPointPosition(sketchId, selectedLine.id, pointRef, target)
  }

  function fitView() {
    const padding = 110
    const bounds = sketchBounds(activeSketch.entities)
    // With nothing drawn yet, frame the face being sketched on so the user has
    // some context; with no face either there is nothing to frame.
    if (!activeSketch.entities.length || bounds.width < 1e-9 || bounds.height < 1e-9) {
      if (!activeSketch.attachment) {
        resetView()
        return
      }
      setView(frameBounds(activeSketch.attachment.bounds.min, activeSketch.attachment.bounds.max, size, padding))
      return
    }
    setView(frameBounds(bounds.min, bounds.max, size, padding))
  }

  const toX = (value: number) => modelToScreen(view, size, [value, 0])[0]
  const toY = (value: number) => modelToScreen(view, size, [0, value])[1]

  /**
   * An arc as an SVG path.
   *
   * The sweep flag is always 1 because arcs are stored sweeping
   * counter-clockwise and the screen's Y axis points down, which turns that
   * into a clockwise sweep here — the same reasoning the sheet renderer uses.
   */
  function arcPath(arc: ArcLike) {
    const radius = arc.radius * view.scale
    const sweep = arc.endAngle - arc.startAngle
    const from = arcStartPoint(arc)
    const arcTo = (target: Vec2, large: 0 | 1) =>
      `A ${radius} ${radius} 0 ${large} 1 ${toX(target[0])} ${toY(target[1])}`
    // A full turn starts and ends at the same point, which a single arc command
    // cannot describe, so it goes round in two halves.
    if (sweep >= Math.PI * 2 - 1e-9) {
      return `M ${toX(from[0])} ${toY(from[1])} ${arcTo(arcPointAt(arc, 0.5), 0)} ${arcTo(from, 0)}`
    }
    return `M ${toX(from[0])} ${toY(from[1])} ${arcTo(arcEndPoint(arc), sweep > Math.PI ? 1 : 0)}`
  }
  const originX = toX(0)
  const originY = toY(0)
  const minorUnits = displayUnits === 'in-fractional'
    ? view.scale >= 2.4 ? 25.4 / 16 : view.scale >= 0.9 ? 25.4 / 4 : 25.4
    : displayUnits === 'in-decimal'
      ? view.scale >= 2.4 ? 2.54 : view.scale >= 0.9 ? 6.35 : 25.4
      : view.scale >= 2.4 ? 1 : view.scale >= 0.9 ? 5 : 10
  const majorUnits = displayUnits === 'mm' ? view.scale >= 2.4 ? 10 : view.scale >= 0.9 ? 25 : 50 : 25.4
  const minorSpacing = minorUnits * view.scale
  const majorSpacing = majorUnits * view.scale
  const previewEnd = start && cursor && tool === 'line'
    ? activeSnap ? cursor : snapLineEnd(start, cursor, angleSnap, sketchSnap, fineAngleControl ? 0.25 : 4)
    : cursor
  const previewAngleSnap = start && previewEnd && tool === 'line'
    ? inferredLineAngle(start, previewEnd, angleSnap, Boolean(activeSnap), fineAngleControl ? 0.25 : 4)
    : null
  /** The arc the third click would commit, previewed as the pointer sweeps. */
  const pendingArcPreview = pendingArc && cursor
    ? arcFromCenterAndPoints(pendingArc.center, pendingArc.start, cursor)
    : null
  const threePointArcPreview = pendingThreePointArc?.end && cursor
    ? arcFromThreePoints(pendingThreePointArc.start, pendingThreePointArc.end, cursor)
    : null
  const tangentArcPreview = pendingTangentArc && cursor
    ? tangentArcFromEndpoint(pendingTangentArc.point, cursor, pendingTangentArc.tangent)
    : null

  function readout() {
    if (!cursor) return null
    if (pendingArcPreview) {
      const degrees = ((pendingArcPreview.endAngle - pendingArcPreview.startAngle) * 180) / Math.PI
      return `R ${formatLength(pendingArcPreview.radius, displayUnits)}   ∠ ${degrees.toFixed(1)}°`
    }
    if (pendingArc) return 'Choose the arc end point'
    if (tool === 'arc' && start) return `Choose radius/start point   R ${formatLength(distance(start, cursor), displayUnits)}`
    if (threePointArcPreview) {
      const degrees = ((threePointArcPreview.endAngle - threePointArcPreview.startAngle) * 180) / Math.PI
      return `R ${formatLength(threePointArcPreview.radius, displayUnits)}   ∠ ${degrees.toFixed(1)}°`
    }
    if (pendingThreePointArc) return pendingThreePointArc.end ? 'Choose a point on the arc' : 'Choose the arc end point'
    if (tangentArcPreview) return `R ${formatLength(tangentArcPreview.radius, displayUnits)}   tangent`
    if (tool === 'tangent-arc') return pendingTangentArc ? 'Choose the arc end point' : 'Choose a line or arc endpoint'
    if (tool === 'trim') return trimPreview ? 'Click to remove the highlighted piece' : 'Hover a curve to trim it back to a crossing'
    if (!start || !previewEnd) return `X ${formatLength(cursor[0], displayUnits)}   Y ${formatLength(cursor[1], displayUnits)}`
    if (tool === 'circle') return `R ${formatLength(distance(start, previewEnd), displayUnits)}`
    if (tool === 'arc') return `R ${formatLength(distance(start, previewEnd), displayUnits)}`
    if (tool === 'rectangle') return `W ${formatLength(Math.abs(previewEnd[0] - start[0]), displayUnits)}   H ${formatLength(Math.abs(previewEnd[1] - start[1]), displayUnits)}`
    return `L ${formatLength(distance(start, previewEnd), displayUnits)}   ∠ ${normalizeDegrees(lineAngle(start, previewEnd)).toFixed(1)}°`
  }

  return (
    <div className={`sketch-editor${activeSketch.attachment ? ' attached' : ''}`}>
      <svg
        ref={svgRef}
        className={`sketch-surface${isPanning ? ' panning' : ''}${tool === 'select' ? ' selecting' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          <pattern id="minor-grid" x={originX} y={originY} width={minorSpacing} height={minorSpacing} patternUnits="userSpaceOnUse">
            <path d={`M ${minorSpacing} 0 L 0 0 0 ${minorSpacing}`} fill="none" stroke="#29312f" strokeWidth="0.45" />
          </pattern>
          <pattern id="major-grid" x={originX} y={originY} width={majorSpacing} height={majorSpacing} patternUnits="userSpaceOnUse">
            <path d={`M ${majorSpacing} 0 L 0 0 0 ${majorSpacing}`} fill="none" stroke="#3b4542" strokeWidth="0.75" />
          </pattern>
        </defs>
        <rect width={size.width} height={size.height} fill="#101413" fillOpacity={activeSketch.attachment ? 0.2 : 0.62} />
        <rect width={size.width} height={size.height} fill="url(#minor-grid)" />
        <rect width={size.width} height={size.height} fill="url(#major-grid)" />
        <line x1={0} y1={originY} x2={size.width} y2={originY} className="sketch-axis x-axis" />
        <line x1={originX} y1={0} x2={originX} y2={size.height} className="sketch-axis y-axis" />
        <circle cx={originX} cy={originY} r="3.5" className="sketch-origin" />

        {activeSketch.attachment && <g className="face-reference-geometry">
          {activeSketch.attachment.edges.map((edge, index) => <line key={index} x1={toX(edge.start[0])} y1={toY(edge.start[1])} x2={toX(edge.end[0])} y2={toY(edge.end[1])} />)}
          {activeSketch.attachment.edges.map((edge, index) => <circle key={`mid-${index}`} cx={toX((edge.start[0] + edge.end[0]) / 2)} cy={toY((edge.start[1] + edge.end[1]) / 2)} r="2.3" className="face-reference-midpoint" />)}
          <path d={`M ${toX(activeSketch.attachment.center[0]) - 7} ${toY(activeSketch.attachment.center[1])} h 14 M ${toX(activeSketch.attachment.center[0])} ${toY(activeSketch.attachment.center[1]) - 7} v 14`} className="face-reference-center" />
          <circle cx={toX(activeSketch.attachment.center[0])} cy={toY(activeSketch.attachment.center[1])} r="3.2" className="face-reference-center-ring" />
        </g>}
        {tool === 'line' && activeRuler && <LineRulerOverlay
          ruler={activeRuler}
          units={displayUnits}
          toX={toX}
          toY={toY}
        />}
        {activeSnap && <g className={`snap-indicator ${activeSnap.source} ${activeSnap.kind}`}>
          <circle cx={toX(activeSnap.point[0])} cy={toY(activeSnap.point[1])} r="6" />
          <text x={toX(activeSnap.point[0]) + 9} y={toY(activeSnap.point[1]) - 9}>{activeSnap.kind}</text>
        </g>}

        {displayEntities.map((entity) => {
          const selection = [
            constraintState,
            selectedEntityIds.includes(entity.id) ? 'selected' : '',
            troubledEntityIds.has(entity.id) ? 'constraint-trouble' : '',
          ].filter(Boolean).join(' ')
          const drag = (event: ReactPointerEvent<SVGGElement>) => beginEntityDrag(event, entity.id)
          if (entity.type === 'line') {
            return (
              <g key={entity.id} data-entity-id={entity.id} className={selection} onPointerDown={drag}>
                <line x1={toX(entity.start[0])} y1={toY(entity.start[1])} x2={toX(entity.end[0])} y2={toY(entity.end[1])} className="sketch-hit-area" />
                <line x1={toX(entity.start[0])} y1={toY(entity.start[1])} x2={toX(entity.end[0])} y2={toY(entity.end[1])} className="sketch-entity" />
                <circle cx={toX(entity.start[0])} cy={toY(entity.start[1])} r="2.6" className="sketch-point" />
                <circle cx={toX(entity.end[0])} cy={toY(entity.end[1])} r="2.6" className="sketch-point" />
                {tool === 'select' && <>
                  <circle
                    cx={toX(entity.start[0])}
                    cy={toY(entity.start[1])}
                    r="8"
                    className="sketch-point-hit-area"
                    onPointerDown={(event) => beginEndpointDrag(event, entity, 'start')}
                  />
                  <circle
                    cx={toX(entity.end[0])}
                    cy={toY(entity.end[1])}
                    r="8"
                    className="sketch-point-hit-area"
                    onPointerDown={(event) => beginEndpointDrag(event, entity, 'end')}
                  />
                </>}
              </g>
            )
          }
          if (entity.type === 'arc') {
            const path = arcPath(entity)
            const from = arcStartPoint(entity)
            const to = arcEndPoint(entity)
            return (
              <g key={entity.id} data-entity-id={entity.id} className={selection} onPointerDown={drag}>
                <path d={path} className="sketch-hit-area" />
                <path d={path} className="sketch-entity" />
                <circle cx={toX(from[0])} cy={toY(from[1])} r="2.6" className="sketch-point" />
                <circle cx={toX(to[0])} cy={toY(to[1])} r="2.6" className="sketch-point" />
                <text
                  x={toX(arcPointAt(entity, 0.5)[0])}
                  y={toY(arcPointAt(entity, 0.5)[1]) - 8}
                  className="dimension-label"
                >R {formatLength(entity.radius, displayUnits)}</text>
              </g>
            )
          }
          return (
            <g key={entity.id} data-entity-id={entity.id} className={selection} onPointerDown={drag}>
              <circle cx={toX(entity.center[0])} cy={toY(entity.center[1])} r={entity.radius * view.scale} className="sketch-hit-area" />
              <circle cx={toX(entity.center[0])} cy={toY(entity.center[1])} r={entity.radius * view.scale} className="sketch-entity" />
              <circle cx={toX(entity.center[0])} cy={toY(entity.center[1])} r="2.6" className="sketch-point" />
              <text x={toX(entity.center[0])} y={toY(entity.center[1] + entity.radius) - 8} className="dimension-label">Ø {formatLength(entity.radius * 2, displayUnits)}</text>
            </g>
          )
        })}

        {activeSketch.constraints.filter((constraint) => constraint.type === 'horizontal' || constraint.type === 'vertical' || constraint.type === 'angle').map((constraint) => {
          const entity = displayEntities.find((candidate) => candidate.id === constraint.entityIds[0])
          if (!entity || entity.type !== 'line') return null
          const midpoint: Vec2 = [(entity.start[0] + entity.end[0]) / 2, (entity.start[1] + entity.end[1]) / 2]
          const label = constraint.type === 'horizontal' ? 'H' : constraint.type === 'vertical' ? 'V' : `${normalizeDegrees(constraint.value ?? 0).toFixed(0)}°`
          return <text key={constraint.id} x={toX(midpoint[0]) + 6} y={toY(midpoint[1]) - 6} className="constraint-label">{label}</text>
        })}

        {activeSketch.constraints.filter((constraint) => constraint.type === 'distance').map((constraint) => {
          const entity = displayEntities.find((candidate) => candidate.id === constraint.entityIds[0])
          if (!entity || entity.type !== 'line') return null
          const midpoint: Vec2 = [(entity.start[0] + entity.end[0]) / 2, (entity.start[1] + entity.end[1]) / 2]
          return <text key={constraint.id} x={toX(midpoint[0])} y={toY(midpoint[1]) - 15} className="dimension-label">{formatLength(constraint.value ?? distance(entity.start, entity.end), displayUnits)}</text>
        })}

        {trimPreview && trimPreview.length > 1 && (
          <polyline
            className="trim-removal-preview"
            points={trimPreview.map((point) => `${toX(point[0])},${toY(point[1])}`).join(' ')}
          />
        )}
        {start && previewEnd && <Preview tool={tool} start={start} end={previewEnd} scale={view.scale} toX={toX} toY={toY} />}
        {start && previewEnd && previewAngleSnap !== null && <g className="angle-inference-indicator">
          <line x1={toX(start[0])} y1={toY(start[1])} x2={toX(previewEnd[0])} y2={toY(previewEnd[1])} />
          <text x={toX(previewEnd[0]) + 10} y={toY(previewEnd[1]) + 14}>
            {normalizeDegrees(previewAngleSnap).toFixed(0)}°
          </text>
        </g>}
        {pendingArcPreview && <>
          <path d={arcPath(pendingArcPreview)} className="sketch-preview" />
          <circle cx={toX(pendingArc!.center[0])} cy={toY(pendingArc!.center[1])} r="2.6" className="sketch-point" />
        </>}
        {pendingThreePointArc && <>
          {pendingThreePointArc.end
            ? threePointArcPreview && <path d={arcPath(threePointArcPreview)} className="sketch-preview" />
            : cursor && <line x1={toX(pendingThreePointArc.start[0])} y1={toY(pendingThreePointArc.start[1])} x2={toX(cursor[0])} y2={toY(cursor[1])} className="sketch-preview" />}
          <circle cx={toX(pendingThreePointArc.start[0])} cy={toY(pendingThreePointArc.start[1])} r="2.6" className="sketch-point" />
          {pendingThreePointArc.end && <circle cx={toX(pendingThreePointArc.end[0])} cy={toY(pendingThreePointArc.end[1])} r="2.6" className="sketch-point" />}
        </>}
        {pendingTangentArc && <>
          {tangentArcPreview && <path d={arcPath(tangentArcPreview)} className="sketch-preview" />}
          <circle cx={toX(pendingTangentArc.point[0])} cy={toY(pendingTangentArc.point[1])} r="3.4" className="sketch-point" />
        </>}
      </svg>

      <div className="sketch-mode-banner"><span>EDITING</span> {activeSketch.name} <em>{activeSketch.plane} PLANE{Math.abs(activeSketch.parameters.planeOffset) > 1e-9 ? ` @ ${formatLength(activeSketch.parameters.planeOffset, displayUnits)}` : ''}</em></div>
      <div className={`solver-badge ${solver.status}`} title={solver.message}><span /> {solver.status === 'loading' ? 'SOLVING…' : solver.status === 'error' ? 'CONSTRAINT ISSUE' : solver.degreesOfFreedom === 0 ? 'FULLY CONSTRAINED' : solver.degreesOfFreedom === null ? 'SOLVER READY' : `${solver.degreesOfFreedom} DOF REMAIN`}</div>
      {activeSketch.attachment && <div className="face-reference-panel">
        <div><span>ATTACHED FACE</span><strong>{activeSketch.attachment.featureName} · {activeSketch.attachment.faceLabel}</strong></div>
        <dl>
          <dt>Size</dt><dd>{formatLength(activeSketch.attachment.bounds.max[0] - activeSketch.attachment.bounds.min[0], displayUnits)} × {formatLength(activeSketch.attachment.bounds.max[1] - activeSketch.attachment.bounds.min[1], displayUnits)}</dd>
          <dt>Center</dt><dd>{formatLength(activeSketch.attachment.center[0], displayUnits)}, {formatLength(activeSketch.attachment.center[1], displayUnits)}</dd>
          <dt>Area</dt><dd>{displayUnits === 'mm' ? `${activeSketch.attachment.area.toFixed(1)} mm²` : `${(activeSketch.attachment.area / 645.16).toFixed(3)} in²`}</dd>
        </dl>
        <p>Snap targets: center, corners, edge midpoints, and edges</p>
      </div>}
      <ConstraintPanel
        sketch={activeSketch}
        selectedEntityIds={selectedEntityIds}
        conflicting={solver.conflicting}
        redundant={solver.redundant}
        unsupported={solver.unsupported}
        displayUnits={displayUnits}
        onHighlight={setHoveredConstraintEntityIds}
      />
      {selectedLine && (
        <div className="line-endpoint-panel">
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
                    value={endpointDraft[draftIndex]}
                    onChange={(event) => setEndpointDraft((current) => {
                      const next: [string, string, string, string] = [...current]
                      next[draftIndex] = event.target.value
                      return next
                    })}
                    onBlur={() => commitEndpoint(pointRef)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        setEndpointDraft([
                          formatLengthInput(selectedLine.start[0], displayUnits),
                          formatLengthInput(selectedLine.start[1], displayUnits),
                          formatLengthInput(selectedLine.end[0], displayUnits),
                          formatLengthInput(selectedLine.end[1], displayUnits),
                        ])
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
      )}
      {placementCenter && (
        <div className={`sketch-position-panel${selectedLine ? ' with-line-endpoints' : ''}`}>
          <div className="sketch-position-heading">
            <span>{selectedEntityId ? 'SELECTION' : 'SKETCH'} POSITION</span>
            <small>center</small>
          </div>
          <div className="sketch-position-fields">
            {(['X', 'Y'] as const).map((axis, index) => (
              <label key={axis}>
                <span>{axis}</span>
                <input
                  aria-label={`${selectedEntityId ? 'Selection' : 'Sketch'} center ${axis}`}
                  inputMode="decimal"
                  value={positionDraft[index]}
                  onChange={(event) => setPositionDraft((current) => {
                    const next: [string, string] = [...current]
                    next[index] = event.target.value
                    return next
                  })}
                  onBlur={commitPosition}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      skipPositionCommitRef.current = true
                      setPositionDraft([formatLengthInput(placementCenter[0], displayUnits), formatLengthInput(placementCenter[1], displayUnits)])
                      event.currentTarget.blur()
                    }
                  }}
                />
                <em>{unitLabel(displayUnits)}</em>
              </label>
            ))}
          </div>
          <button onMouseDown={(event) => event.preventDefault()} onClick={() => centerAt([0, 0])}><Crosshair /> Center at 0,0</button>
          {activeSketch.attachment && <button className="center-on-face" onMouseDown={(event) => event.preventDefault()} onClick={() => centerAt(activeSketch.attachment!.center)}><Crosshair /> Center on face</button>}
          <p>{selectedEntityId ? 'Positions the connected profile' : 'Positions all sketch geometry'}</p>
        </div>
      )}
      <div className="sketch-toolbar">
        <button className={tool === 'select' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('select')}><MousePointer2 /> Select <kbd>V</kbd></button>
        <button className={tool === 'line' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('line')}><PenLine /> Line <kbd>L</kbd></button>
        <button className={tool === 'rectangle' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('rectangle')}><RectangleHorizontal /> Rectangle <kbd>R</kbd></button>
        <button className={tool === 'circle' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('circle')}><Circle /> Circle <kbd>C</kbd></button>
        <button className={tool === 'arc' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('arc')} title="Click centre, arc start, then arc end"><Spline /> Arc <kbd>A</kbd></button>
        <button className={tool === 'three-point-arc' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('three-point-arc')} title="Start, end, then a point on the arc"><Spline /> 3-Point Arc <kbd>G</kbd></button>
        <button className={tool === 'tangent-arc' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('tangent-arc')} title="Choose an existing endpoint, then the new arc endpoint"><Spline /> Tangent Arc <kbd>T</kbd></button>
        <button className={tool === 'trim' ? 'active' : ''} onClick={() => useDocumentStore.getState().setSketchTool('trim')} title="Click a piece of a curve to cut it back to where its neighbours cross it"><Scissors /> Trim <kbd>X</kbd></button>
        <label className="angle-snap-control" title="Smart mode acquires common 0°, 45°, 90° and 135° directions">
          <span>ANGLE</span>
          <select value={angleSnap} onChange={(event) => setAngleSnap(Number(event.target.value) as 0 | 15 | 30 | 45)}>
            <option value={0}>Smart</option>
            <option value={15}>15°</option>
            <option value={30}>30°</option>
            <option value={45}>45°</option>
          </select>
        </label>
        <span className="sketch-toolbar-separator" />
        {selectedEntityIds.length === 2 && (
          <label className="sketch-fillet-control" title="Round the corner between the two selected lines">
            <span>FILLET R</span>
            <input
              aria-label="Sketch fillet radius"
              value={filletRadiusDraft}
              onChange={(event) => { setFilletRadiusDraft(event.target.value); setFilletError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') applyCornerFillet() }}
            />
            <button onClick={applyCornerFillet}>Apply</button>
          </label>
        )}
        <button onClick={() => { useDocumentStore.getState().undo(); setStart(null) }}><RotateCcw /> Undo</button>
        {selectedEntityId && <button title="Delete selected entity" onClick={() => { useDocumentStore.getState().deleteSketchEntity(sketchId, selectedEntityId); setSelectedEntityId(null) }}><Trash2 /> Delete</button>}
        <button className="finish-sketch" onClick={() => useDocumentStore.getState().finishSketch()}><Check /> Finish sketch</button>
      </div>

      <div className="sketch-view-controls">
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoomFromCenter(1.25)}><ZoomIn /></button>
        <span>{Math.round(view.scale / INITIAL_SCALE * 100)}%</span>
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoomFromCenter(0.8)}><ZoomOut /></button>
        <button title="Fit sketch" aria-label="Fit sketch" onClick={fitView}><Maximize2 /></button>
        <button title="Reset view" aria-label="Reset sketch view" onClick={resetView}><Focus /></button>
      </div>
      <div className="sketch-navigation-hint">Wheel to zoom · Middle-drag or Space-drag to pan</div>
      {filletError && <div className="selection-status invalid">{filletError}</div>}
      {!filletError && selectedEntityIds.length === 2 && <div className="selection-status">Two entities selected · set a radius and apply to round the corner</div>}
      {!filletError && selectedEntityIds.length !== 2 && selectedEntityId && <div className="selection-status">Selected geometry · drag endpoints or body · Delete to remove</div>}
      <div className={`profile-status ${regions.length ? 'closed' : ''}`}>
        {regions.length ? <><Check /> {regions.length} region{regions.length > 1 ? 's' : ''} ready{holeCount ? ` · ${holeCount} hole${holeCount > 1 ? 's' : ''}` : ''}</> : <><MousePointer2 /> Draw a closed profile</>}
      </div>
      {readout() && <div className="cursor-coordinate">{readout()}</div>}
    </div>
  )
}

function Preview({ tool, start, end, scale, toX, toY }: {
  tool: EditorTool
  start: Vec2
  end: Vec2
  scale: number
  toX: (value: number) => number
  toY: (value: number) => number
}) {
  if (tool === 'circle') {
    return <circle cx={toX(start[0])} cy={toY(start[1])} r={distance(start, end) * scale} className="sketch-preview" />
  }
  if (tool === 'arc') {
    // Only the centre and radius are settled at this point, so the preview is
    // the circle the arc will be cut from, with the radius being dragged.
    return <>
      <circle cx={toX(start[0])} cy={toY(start[1])} r={distance(start, end) * scale} className="sketch-preview" />
      <line x1={toX(start[0])} y1={toY(start[1])} x2={toX(end[0])} y2={toY(end[1])} className="sketch-preview" />
    </>
  }
  if (tool === 'rectangle') {
    const left = Math.min(start[0], end[0])
    const top = Math.max(start[1], end[1])
    return <rect x={toX(left)} y={toY(top)} width={Math.abs(end[0] - start[0]) * scale} height={Math.abs(end[1] - start[1]) * scale} className="sketch-preview" />
  }
  return <line x1={toX(start[0])} y1={toY(start[1])} x2={toX(end[0])} y2={toY(end[1])} className="sketch-preview" />
}

function LineRulerOverlay({ ruler, units, toX, toY }: {
  ruler: LineRuler
  units: DisplayUnits
  toX: (value: number) => number
  toY: (value: number) => number
}) {
  const start = [toX(ruler.start[0]), toY(ruler.start[1])] as Vec2
  const end = [toX(ruler.end[0]), toY(ruler.end[1])] as Vec2
  const screenLength = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (screenLength < 1e-6) return null
  const tangent: Vec2 = [(end[0] - start[0]) / screenLength, (end[1] - start[1]) / screenLength]
  const normal: Vec2 = [-tangent[1], tangent[0]]
  const offset = 11
  const screenPointAtDistance = (distanceFromDatum: number): Vec2 => {
    const fromStart = ruler.datum === 'start' ? distanceFromDatum : ruler.length - distanceFromDatum
    const ratio = ruler.length > 1e-9 ? fromStart / ruler.length : 0
    return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]
  }
  const datumPoint = screenPointAtDistance(0)
  const indicatedDistance = ruler.snap?.distance ?? ruler.projectedDistance
  const indicatedPoint = screenPointAtDistance(indicatedDistance)
  const readout = `${formatLength(indicatedDistance, units)} from ${ruler.datum}`
  const readoutWidth = Math.max(148, readout.length * 6.5)

  return <g className="line-ruler" data-line-id={ruler.lineId} data-datum={ruler.datum}>
    <line
      className="line-ruler-baseline"
      x1={start[0] + normal[0] * offset}
      y1={start[1] + normal[1] * offset}
      x2={end[0] + normal[0] * offset}
      y2={end[1] + normal[1] * offset}
    />
    {ruler.ticks.map((tick) => {
      const point = screenPointAtDistance(tick.distance)
      const active = tick.distance >= ruler.activeInterval[0] - 1e-8
        && tick.distance <= ruler.activeInterval[1] + 1e-8
      const inner = offset - (tick.major ? 4 : 1)
      const outer = offset + (tick.major ? 8 : 5)
      return <g
        key={`${tick.distance}-${tick.major ? 'major' : 'minor'}`}
        className={`line-ruler-tick ${tick.major ? 'major' : 'minor'}${active ? ' active' : ''}`}
        data-distance={tick.distance}
      >
        <line
          x1={point[0] + normal[0] * inner}
          y1={point[1] + normal[1] * inner}
          x2={point[0] + normal[0] * outer}
          y2={point[1] + normal[1] * outer}
        />
        {tick.major && <text
          x={point[0] + normal[0] * (offset + 19)}
          y={point[1] + normal[1] * (offset + 19)}
        >{formatLengthInput(tick.distance, units)}</text>}
      </g>
    })}
    <circle className="line-ruler-datum" cx={datumPoint[0]} cy={datumPoint[1]} r="3.2" />
    <g
      className="line-ruler-readout"
      transform={`translate(${indicatedPoint[0] + normal[0] * 47} ${indicatedPoint[1] + normal[1] * 47})`}
    >
      <rect x={-readoutWidth / 2} y="-18" width={readoutWidth} height="40" rx="5" />
      <text y="-3">{readout}</text>
      <text className="line-ruler-hint" y="13">TAB FLIPS DATUM</text>
    </g>
  </g>
}
