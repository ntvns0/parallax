import { useCallback, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import type { LineEntity, SketchEntity, Vec2 } from '../core/model'
import { translateSketchEntities } from '../core/sketch'
import { applySketchPointPosition, applySketchTranslation } from './sketch-edits'
import { distance, type ActiveSnap } from './sketch-geometry-builders'
import { snapToIncrement, type ResolvedPoint } from './sketch-point-resolution'
import type { SketchView } from './sketch-view'

/**
 * The three things a press can turn into that are not drawing: panning the
 * view, dragging a connected profile, and dragging one line end.
 *
 * Drags preview locally and touch the document once, on release, through the
 * solver, so a drag is one undo step and the solver never sees a half-move.
 */

type PanDrag = {
  pointerId: number
  clientX: number
  clientY: number
  panX: number
  panY: number
}

type EntityDrag = {
  pointerId: number
  start: Vec2
  source: SketchEntity[]
  entityIds: Set<string>
  /** Total offset from the drag origin, replayed through the solver on release. */
  delta: Vec2
}

type EndpointDrag = {
  pointerId: number
  entityId: string
  pointRef: 'start' | 'end'
  source: SketchEntity[]
  target: Vec2
  moved: boolean
}

/**
 * Where the pointer is in the model. `applySnap` false gives the raw position;
 * `excludedEntityId` keeps a line from snapping to itself.
 */
export type LocatePointer = (applySnap: boolean, excludedEntityId?: string) => ResolvedPoint

function setLineEndpoint(entities: SketchEntity[], entityId: string, pointRef: 'start' | 'end', point: Vec2) {
  return entities.map((entity) => entity.id === entityId && entity.type === 'line'
    ? { ...entity, [pointRef]: point }
    : entity)
}

export function useSketchDrags(sketchId: string, setView: Dispatch<SetStateAction<SketchView>>, gridIncrement: number) {
  const panRef = useRef<PanDrag | null>(null)
  const entityRef = useRef<EntityDrag | null>(null)
  const endpointRef = useRef<EndpointDrag | null>(null)
  /** The sketch as the drag in progress would leave it, or null with no drag. */
  const [dragEntities, setDragEntities] = useState<SketchEntity[] | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  function beginPan(event: ReactPointerEvent, view: SketchView) {
    panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, panX: view.panX, panY: view.panY }
    setIsPanning(true)
  }

  function beginEntityDrag(pointerId: number, start: Vec2, entities: SketchEntity[], entityIds: Set<string>) {
    entityRef.current = { pointerId, start, source: structuredClone(entities), entityIds, delta: [0, 0] }
  }

  function beginEndpointDrag(pointerId: number, line: LineEntity, pointRef: 'start' | 'end', entities: SketchEntity[]) {
    endpointRef.current = {
      pointerId, entityId: line.id, pointRef, source: structuredClone(entities), target: line[pointRef], moved: false,
    }
  }

  /**
   * Follow the pointer. Returns where the cursor and snap marker belong, `'pan'`
   * when the view moved instead, or null when no drag owns this pointer.
   */
  function move(event: ReactPointerEvent, locate: LocatePointer): { cursor: Vec2; snap: ActiveSnap | null } | 'pan' | null {
    const endpoint = endpointRef.current
    if (endpoint?.pointerId === event.pointerId) {
      // Alt bypasses snapping, for placing an end just off a snap target.
      const result = locate(!event.altKey, endpoint.entityId)
      const original = endpoint.source.find((entity) => entity.id === endpoint.entityId) as LineEntity
      endpoint.target = result.point
      endpoint.moved = distance(original[endpoint.pointRef], result.point) > 1e-9
      setDragEntities(setLineEndpoint(endpoint.source, endpoint.entityId, endpoint.pointRef, result.point))
      return { cursor: result.point, snap: result.snap }
    }
    const entity = entityRef.current
    if (entity?.pointerId === event.pointerId) {
      const { point } = locate(false)
      entity.delta = [
        snapToIncrement(point[0] - entity.start[0], gridIncrement),
        snapToIncrement(point[1] - entity.start[1], gridIncrement),
      ]
      setDragEntities(translateSketchEntities(entity.source, entity.entityIds, entity.delta))
      return { cursor: point, snap: null }
    }
    const pan = panRef.current
    if (pan?.pointerId === event.pointerId) {
      setView((current) => ({
        ...current,
        panX: pan.panX + event.clientX - pan.clientX,
        panY: pan.panY + event.clientY - pan.clientY,
      }))
      return 'pan'
    }
    return null
  }

  /** Finish whichever drag owns this pointer. True when one did. */
  function end(pointerId: number) {
    const endpoint = endpointRef.current
    if (endpoint?.pointerId === pointerId) {
      endpointRef.current = null
      setDragEntities(null)
      if (endpoint.moved) void applySketchPointPosition(sketchId, endpoint.entityId, endpoint.pointRef, endpoint.target)
      return true
    }
    const entity = entityRef.current
    if (entity?.pointerId === pointerId) {
      entityRef.current = null
      setDragEntities(null)
      if (entity.delta[0] !== 0 || entity.delta[1] !== 0) void applySketchTranslation(sketchId, entity.entityIds, entity.delta)
      return true
    }
    if (panRef.current?.pointerId === pointerId) {
      panRef.current = null
      setIsPanning(false)
      return true
    }
    return false
  }

  /** Drop whichever drag owns this pointer — every drag, with none given — leaving the sketch as it was. */
  // Stable, because the editor's keyboard listener holds on to it.
  const cancel = useCallback((pointerId?: number) => {
    const owns = (drag: { pointerId: number } | null) => drag !== null && (pointerId === undefined || drag.pointerId === pointerId)
    const geometry = owns(entityRef.current) || owns(endpointRef.current)
    if (geometry) {
      entityRef.current = null
      endpointRef.current = null
      setDragEntities(null)
    }
    if (pointerId !== undefined && owns(panRef.current)) {
      panRef.current = null
      setIsPanning(false)
    }
    return geometry
  }, [])

  return { dragEntities, isPanning, beginPan, beginEntityDrag, beginEndpointDrag, move, end, cancel }
}
