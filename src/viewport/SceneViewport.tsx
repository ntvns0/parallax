import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

import { useDocumentStore } from '../core/document-store'
import { currentPlaneOffset } from '../core/face-anchor'
import type { MeasurementState } from '../core/measurement'
import type { FilletEdgeReference } from '../core/model'
import { onCameraCommand } from './camera-commands'
import { pickEdgeChain, worldEdgeSegments, type EdgeSegment } from './edge-references'
import { EdgeHighlight } from './edge-highlight'
import { ExactEdgeIndex } from './exact-edge-index'
import { FaceHighlight } from './face-highlight'
import { MeasurementOverlay } from './measurement-overlay'
import { MeasurementSnapper } from './measurement-snapping'
import { edgeSourceOf } from './model-edges'
import { projectPartEdges } from './projected-references'
import { PushPullGesture } from './push-pull-gesture'
import { SceneModels } from './scene-models'
import { classifySketchFace, NO_FACE, sketchFacePickKey, type SketchFacePickResult } from './sketch-face-pick'
import { ViewportController } from './viewport-controller'
import { ViewportPicker } from './viewport-picker'
import { useViewportStore } from './viewport-store'

export type { SketchFacePickResult } from './sketch-face-pick'

export type FilletEdgePick = { featureId: string; edge: FilletEdgeReference }

/** How far a press may travel and still be a click, in pixels. */
const CLICK_SLOP_PX = 4
/** How near an edge the pointer must be to pick it for a fillet, in pixels. */
const FILLET_EDGE_REACH_PX = 20

type ViewportProps = {
  pickSketchFace?: boolean
  onSketchFacePick?: (result: SketchFacePickResult) => void
  onSketchFaceHover?: (result: SketchFacePickResult | null) => void
  measureMode?: boolean
  onMeasurementChange?: (measurement: MeasurementState) => void
  filletTargetId?: string | null
  filletEdges?: FilletEdgeReference[]
  onFilletEdgePick?: (pick: FilletEdgePick) => void
  onFilletEdgeMiss?: () => void
}

/**
 * The 3D view. The scene, camera, and render loop belong to
 * `ViewportController`; the part to `SceneModels`. This component decides
 * what a pointer gesture means in the current mode — picking a sketch face,
 * measuring, choosing fillet edges, pulling a face, or selecting — and hands
 * it to the unit that does it.
 */
export function SceneViewport(props: ViewportProps) {
  const { pickSketchFace = false, measureMode = false, filletTargetId = null, filletEdges } = props
  const hostRef = useRef<HTMLDivElement>(null)
  // The scene lives for the component's lifetime; props reach it through this.
  const propsRef = useRef(props)
  propsRef.current = props
  const syncFilletEdgesRef = useRef<((edges: FilletEdgeReference[] | undefined) => void) | null>(null)
  const syncMeasurementModeRef = useRef<((active: boolean) => void) | null>(null)
  const requestRenderRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    syncFilletEdgesRef.current?.(filletEdges)
  }, [filletEdges, filletTargetId])

  useEffect(() => {
    syncMeasurementModeRef.current?.(measureMode)
  }, [measureMode])

  // The viewport draws only on request. A change of mode or selection arrives
  // as new props, and may change what the scene shows.
  useEffect(() => {
    requestRenderRef.current?.()
  })

  useEffect(() => {
    if (!hostRef.current) return
    const host = hostRef.current
    const current = () => propsRef.current
    const inMode = () => Boolean(current().pickSketchFace || current().measureMode || current().filletTargetId)

    const controller = new ViewportController(host, {
      onCameraDistanceChange: (distance) => useViewportStore.getState().setCameraDistance(distance),
    })
    const { scene, renderer, orbit, measurementGroup } = controller
    const canvas = renderer.domElement
    controller.setProjection(useViewportStore.getState().projectionMode)
    const picker = new ViewportPicker(canvas, () => controller.activeCamera())
    const edgeHighlight = new EdgeHighlight()
    const overlay = new MeasurementOverlay(
      host, measurementGroup, (point) => controller.millimetresPerPixelAt(point), picker, edgeHighlight,
      (measurement) => current().onMeasurementChange?.(measurement),
    )
    const snapper = new MeasurementSnapper(picker)
    const faceHighlight = new FaceHighlight(host)

    const transform = new TransformControls(controller.activeCamera(), canvas)
    transform.setMode('translate')
    transform.setSize(0.82)
    transform.translationSnap = 1
    scene.add(transform.getHelper())
    transform.addEventListener('change', () => controller.requestRender())
    let transformDragging = false
    transform.addEventListener('dragging-changed', (event) => {
      transformDragging = Boolean(event.value)
      orbit.enabled = !transformDragging
    })
    transform.addEventListener('mouseUp', () => {
      const object = transform.object
      const id = object?.userData.featureId as string | undefined
      if (object && id) useDocumentStore.getState().setFeaturePosition(id, [object.position.x, object.position.y, object.position.z])
    })

    const models = new SceneModels(controller, host, transform, {
      onDispose: () => {
        faceHighlight.clear()
        snapper.clearCache()
      },
      canAttachGizmo: () => !inMode(),
      onSolidsChanged: () => publishProjectedEdges(),
    })
    const pushPull = new PushPullGesture(host, canvas, orbit, picker, () => models.meshes.values())
    const hitAt = (event: PointerEvent) => picker.intersect(event, models.meshes.values())

    syncMeasurementModeRef.current = (active) => {
      if (!active) overlay.reset()
    }

    // Fillet edges: those already chosen, plus the one under the pointer.
    const filletSelected = new Map<string, EdgeSegment[]>()
    let filletHover: EdgeSegment[] = []
    const showFilletEdges = () => edgeHighlight.show([...filletSelected.values()].flat().concat(filletHover), '#ff4d4d')
    syncFilletEdgesRef.current = (edges) => {
      filletSelected.clear()
      const targetId = current().filletTargetId
      const targetMesh = targetId ? models.meshes.get(targetId) : undefined
      const exactIndex = edges?.length && targetMesh ? new ExactEdgeIndex(targetMesh.userData.kernelMesh) : null
      // An edge the exact solid still has is drawn where it now is; one it has
      // lost is drawn where it was.
      for (const reference of targetId ? edges ?? [] : []) {
        const matched = exactIndex?.findReferenceMatch(reference) ?? reference
        filletSelected.set(`${reference.start.join(',')}_${reference.end.join(',')}`, [{ start: matched.start, end: matched.end }])
      }
      showFilletEdges()
    }
    function filletEdgeAt(event: PointerEvent) {
      const targetId = current().filletTargetId
      const mesh = targetId ? models.meshes.get(targetId) : undefined
      const edgeSource = mesh && edgeSourceOf(mesh)
      if (!mesh || !edgeSource) return null
      mesh.updateWorldMatrix(true, false)
      const segments = worldEdgeSegments(edgeSource.positions, mesh.matrixWorld)
      return pickEdgeChain(segments, edgeSource.edgeGroups, [event.clientX, event.clientY], picker.project, FILLET_EDGE_REACH_PX)
    }

    let faceHoverKey = ''
    function reportFaceHover(result: SketchFacePickResult | null) {
      const key = result ? sketchFacePickKey(result) : 'none'
      if (key === faceHoverKey) return
      faceHoverKey = key
      current().onSketchFaceHover?.(result)
    }

    models.rebuild()
    syncFilletEdgesRef.current(current().filletEdges)

    /** Offer the open sketch the part's edges, flattened onto its plane, to snap to. */
    function publishProjectedEdges() {
      const state = useDocumentStore.getState()
      const sketch = state.document.features.find((feature) => feature.id === state.activeSketchId)
      const viewport = useViewportStore.getState()
      if (sketch?.kind !== 'sketch') {
        if (viewport.projectedReferences) viewport.setProjectedReferences(null)
        return
      }
      const parts = [...models.meshes.values()].flatMap((mesh) => {
        const source = edgeSourceOf(mesh)
        if (!source) return []
        mesh.updateWorldMatrix(true, false)
        return [{ segments: worldEdgeSegments(source.positions, mesh.matrixWorld), edgeGroups: source.edgeGroups }]
      })
      viewport.setProjectedReferences(projectPartEdges(parts, sketch.plane))
    }

    /** Aim the camera at the open sketch, matching the sketcher's own view of it. */
    function followSketch() {
      const state = useDocumentStore.getState()
      const sketch = state.document.features.find((feature) => feature.id === state.activeSketchId)
      controller.setSketching(sketch?.kind === 'sketch')
      if (sketch?.kind !== 'sketch') return
      const frame = useViewportStore.getState().sketchFrame
      controller.setSketchPlaneView(
        sketch.plane,
        currentPlaneOffset(sketch, state.document.features),
        frame?.center ?? sketch.attachment?.center,
        host.getBoundingClientRect().height,
        frame?.pixelsPerMm,
      )
    }

    const unsubscribeViewport = useViewportStore.subscribe((state, previous) => {
      controller.setBrightness(state.brightness)
      if (state.sketchFrame !== previous.sketchFrame) followSketch()
      if (state.projectionMode !== previous.projectionMode) {
        controller.setProjection(state.projectionMode)
        transform.camera = controller.activeCamera()
      }
    })
    const unsubscribeDocument = useDocumentStore.subscribe((state, previous) => {
      if (state.document !== previous.document) models.documentChanged()
      else if (state.selectedId !== previous.selectedId || state.activeSketchId !== previous.activeSketchId) models.updateSelection()
      if (state.activeSketchId !== previous.activeSketchId) {
        followSketch()
        publishProjectedEdges()
      }
    })
    const stopCameraCommands = onCameraCommand((command) => {
      if (command.kind === 'view') controller.setCameraView(command.view)
      else if (command.kind === 'direction') controller.setCustomViewDirection(command.direction, command.up)
      else if (command.kind === 'roll') controller.rollCamera(command.degrees)
      else controller.reverseView()
    })

    const pressedAt = new THREE.Vector2()

    function onPointerDown(event: PointerEvent) {
      pressedAt.set(event.clientX, event.clientY)
      if (event.button !== 0 || transformDragging || inMode()) return
      if (useDocumentStore.getState().activeSketchId) return
      pushPull.begin(event)
    }

    function onPointerMove(event: PointerEvent) {
      if (pushPull.active) {
        pushPull.move(event)
        return
      }
      const { measureMode, filletTargetId, pickSketchFace } = current()
      if (measureMode) {
        overlay.update({ ...overlay.state, hover: snapper.referenceAt(event, models.meshes) })
        return
      }
      if (filletTargetId) {
        const picked = filletEdgeAt(event)
        filletHover = picked?.segments ?? []
        showFilletEdges()
        overlay.showHoverMarker(picked?.edge.point ?? null)
        return
      }
      if (filletSelected.size || filletHover.length) {
        filletSelected.clear()
        filletHover = []
        showFilletEdges()
      }
      if (!pickSketchFace) {
        // Idle: show which faces can be dragged, so push/pull is discoverable
        // without a mode to enter first.
        if (useDocumentStore.getState().activeSketchId || transform.axis) return
        const picked = pushPull.targetAt(event)
        if (picked) {
          faceHighlight.show(picked.hit, true)
          host.dataset.pushPull = 'available'
        } else if (host.dataset.pushPull === 'available') {
          faceHighlight.clear()
          delete host.dataset.pushPull
        }
        return
      }
      const hit = hitAt(event)[0]
      if (!hit?.face) {
        faceHighlight.clear()
        reportFaceHover(null)
        return
      }
      const result = classifySketchFace(hit)
      faceHighlight.show(hit, result.ok)
      reportFaceHover(result)
    }

    function onPointerLeave() {
      if (pushPull.active) return
      if (host.dataset.pushPull === 'available') {
        faceHighlight.clear()
        delete host.dataset.pushPull
      }
      const { measureMode, filletTargetId, pickSketchFace } = current()
      if (measureMode) {
        overlay.update({ ...overlay.state, hover: null })
      } else if (filletTargetId) {
        filletHover = []
        showFilletEdges()
        overlay.showHoverMarker(null)
      } else if (pickSketchFace) {
        faceHighlight.clear()
        reportFaceHover(null)
      }
    }

    function onPointerUp(event: PointerEvent) {
      // A press that never moved is a click on that face: fall through so it
      // selects the feature, exactly as clicking anywhere else on the solid does.
      if (pushPull.active && pushPull.end(event)) {
        models.updateSelection()
        return
      }
      if (transformDragging || pressedAt.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > CLICK_SLOP_PX) return
      if (transform.axis && !inMode()) return
      const { measureMode, filletTargetId, pickSketchFace } = current()
      if (filletTargetId) {
        const picked = filletEdgeAt(event)
        if (picked) {
          filletHover = []
          current().onFilletEdgePick?.({ featureId: filletTargetId, edge: picked.edge })
        } else current().onFilletEdgeMiss?.()
        return
      }
      if (measureMode) {
        const reference = snapper.referenceAt(event, models.meshes)
        if (!reference) return
        const { start, end } = overlay.state
        overlay.update(!start || end ? { hover: reference, start: reference, end: null } : { hover: reference, start, end: reference })
        return
      }
      const hit = hitAt(event)[0]
      if (pickSketchFace) {
        const result = hit ? classifySketchFace(hit) : NO_FACE
        if (result.ok) faceHighlight.clear()
        current().onSketchFacePick?.(result)
        return
      }
      useDocumentStore.getState().select((hit?.object.userData.featureId as string | undefined) ?? null)
    }

    function onPointerCancel() {
      if (pushPull.end()) models.updateSelection()
    }

    // Hover highlights, snapping markers, measurement and drags all change the
    // scene from input handlers, so any input asks for a frame. The request is
    // a flag read on the next animation frame, after those handlers have run.
    const requestRender = () => controller.requestRender()
    requestRenderRef.current = requestRender
    const inputEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'wheel'] as const
    for (const name of inputEvents) host.addEventListener(name, requestRender, { passive: true })
    window.addEventListener('keydown', requestRender)
    window.addEventListener('keyup', requestRender)
    const pointerHandlers = [
      ['pointercancel', onPointerCancel],
      ['pointerdown', onPointerDown],
      ['pointermove', onPointerMove],
      ['pointerup', onPointerUp],
      ['pointerleave', onPointerLeave],
    ] as const
    for (const [name, handler] of pointerHandlers) canvas.addEventListener(name, handler)

    followSketch()

    return () => {
      unsubscribeDocument()
      unsubscribeViewport()
      stopCameraCommands()
      requestRenderRef.current = null
      syncMeasurementModeRef.current = null
      syncFilletEdgesRef.current = null
      for (const name of inputEvents) host.removeEventListener(name, requestRender)
      window.removeEventListener('keydown', requestRender)
      window.removeEventListener('keyup', requestRender)
      for (const [name, handler] of pointerHandlers) canvas.removeEventListener(name, handler)
      models.dispose()
      useViewportStore.getState().setProjectedReferences(null)
      overlay.dispose()
      edgeHighlight.dispose()
      transform.dispose()
      controller.dispose()
    }
  }, [])

  return <div ref={hostRef} className={`viewport-canvas${pickSketchFace ? ' face-picking' : ''}${measureMode ? ' measuring' : ''}`} aria-label="3D modeling viewport" />
}
