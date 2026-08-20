import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

import { useDocumentStore } from '../core/document-store'
import { createExtrudeToolGeometry, createPreviewGeometry, createRevolveToolGeometry } from '../core/geometry'
import { attributeFaces, type FaceSample } from '../core/face-ownership'
import { clampPulledDistance, distanceAfterPull, pushPullTargetForFace, type PushPullTarget } from '../core/push-pull'
import { sketchSnapIncrement } from '../core/units'

import type { ExtrudeFeature, Feature, FilletEdgeReference, RevolveFeature, SketchFaceAttachment, SketchPlane, Vec2, Vec3 } from '../core/model'
import {
  compareMeasurementSnapCandidates,
  findCircularLoopCenters,
  MEASUREMENT_SNAP_RADIUS_PX,
  measurementEdgeDirection,
  measurementLineOrientation,
  measurementRelativeEdgeAngles,
  type MeasurementReference,
  type MeasurementSnapType,
  type MeasurementState,
} from '../core/measurement'
import { evaluateExactExtrude, kernelMeshToGeometry } from '../kernel/exact-kernel'
import { classifyFaceNormal, projectToSketchPlane, sketchPlaneOffset } from './face-classification'
import { isSolid, planSolidRender } from './render-plan'
import { useViewportStore } from './viewport-store'
import { ViewportController, type CameraView } from './viewport-controller'
import { disposeObject } from './exact-scene-adapter'
import { ExactEdgeIndex } from './exact-edge-index'
import { createModelEdges, edgeSourceOf, setEdgeAppearance, updateModelEdges } from './model-edges'

export type SketchFacePickResult =
  | { ok: true; plane: SketchPlane; planeOffset: number; faceNormalSign: -1 | 1; featureName: string; attachment: SketchFaceAttachment }
  | { ok: false; message: string }

export type FilletEdgePick = { featureId: string; edge: FilletEdgeReference }

export function SceneViewport({
  pickSketchFace = false,
  onSketchFacePick,
  onSketchFaceHover,
  measureMode = false,
  onMeasurementChange,
  filletTargetId = null,
  filletEdges,
  onFilletEdgePick,
  onFilletEdgeMiss,
}: {
  pickSketchFace?: boolean
  onSketchFacePick?: (result: SketchFacePickResult) => void
  onSketchFaceHover?: (result: SketchFacePickResult | null) => void
  measureMode?: boolean
  onMeasurementChange?: (measurement: MeasurementState) => void
  filletTargetId?: string | null
  filletEdges?: FilletEdgeReference[]
  onFilletEdgePick?: (pick: FilletEdgePick) => void
  onFilletEdgeMiss?: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  const pickSketchFaceRef = useRef(pickSketchFace)
  const onSketchFacePickRef = useRef(onSketchFacePick)
  const onSketchFaceHoverRef = useRef(onSketchFaceHover)
  const measureModeRef = useRef(measureMode)
  const onMeasurementChangeRef = useRef(onMeasurementChange)
  const filletTargetIdRef = useRef(filletTargetId)
  const filletEdgesRef = useRef(filletEdges)
  const onFilletEdgePickRef = useRef(onFilletEdgePick)
  const onFilletEdgeMissRef = useRef(onFilletEdgeMiss)
  const syncFilletEdgesRef = useRef<((edges: FilletEdgeReference[] | undefined) => void) | null>(null)
  const syncMeasurementModeRef = useRef<((active: boolean) => void) | null>(null)

  pickSketchFaceRef.current = pickSketchFace
  onSketchFacePickRef.current = onSketchFacePick
  onSketchFaceHoverRef.current = onSketchFaceHover
  measureModeRef.current = measureMode
  onMeasurementChangeRef.current = onMeasurementChange
  filletTargetIdRef.current = filletTargetId
  filletEdgesRef.current = filletEdges
  onFilletEdgePickRef.current = onFilletEdgePick
  onFilletEdgeMissRef.current = onFilletEdgeMiss

  useEffect(() => {
    syncFilletEdgesRef.current?.(filletEdges)
  }, [filletEdges, filletTargetId])

  useEffect(() => {
    syncMeasurementModeRef.current?.(measureMode)
  }, [measureMode])

  useEffect(() => {
    if (!hostRef.current) return
    const host = hostRef.current

    const controller = new ViewportController(host, {
      onCameraDistanceChange: (dist) => useViewportStore.getState().setCameraDistance(dist),
    })

    const { scene, camera, renderer, orbit, modelGroup, measurementGroup } = controller

    const markerGeometry = new THREE.SphereGeometry(1, 20, 14)
    const hoverMarker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: '#f3d27d', depthTest: false }))
    const vertexHalo = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: '#69ddb2', transparent: true, opacity: 0.82, wireframe: true, depthTest: false }))
    const startMarker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: '#69ddb2', depthTest: false }))
    const endMarker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: '#f3d27d', depthTest: false }))
    const measurementLineGeometry = new THREE.BufferGeometry()
    const measurementLine = new THREE.Line(measurementLineGeometry, new THREE.LineDashedMaterial({ color: '#f1cd74', dashSize: 3, gapSize: 1.5, depthTest: false }))
    const measurementAngleGeometry = new THREE.BufferGeometry()
    const measurementAngleArc = new THREE.Line(measurementAngleGeometry, new THREE.LineBasicMaterial({ color: '#f1a95f', depthTest: false, transparent: true, opacity: 0.95 }))
    let edgeHighlightGeometry = new LineSegmentsGeometry()
    const edgeHighlightMaterial = new LineMaterial({ color: '#8ff0cc', transparent: true, opacity: 0.9, depthTest: false, linewidth: 5 })
    const edgeHighlight = new LineSegments2(edgeHighlightGeometry, edgeHighlightMaterial)
    const measurementSnapBadge = document.createElement('div')
    measurementSnapBadge.className = 'measurement-snap-badge'
    measurementSnapBadge.hidden = true
    host.append(measurementSnapBadge)

    hoverMarker.visible = false
    vertexHalo.visible = false
    startMarker.visible = false
    endMarker.visible = false
    measurementLine.visible = false
    measurementAngleArc.visible = false
    edgeHighlight.visible = false
    measurementGroup.add(measurementLine, measurementAngleArc, edgeHighlight, vertexHalo, hoverMarker, startMarker, endMarker)

    const meshes = new Map<string, THREE.Mesh>()
    const sketchLines = new Map<string, THREE.LineSegments>()
    const pendingGhosts = new Map<string, THREE.Mesh>()
    let featureHighlight: THREE.Mesh | null = null
    let rebuildGeneration = 0
    let geometrySignature = ''
    let faceHighlight: THREE.Group | null = null
    let highlightedFaceKey = ''
    let hoverResultKey = ''
    let measurement: MeasurementState = { hover: null, start: null, end: null }
    let measurementKey = ''
    let filletHoverSegments: { start: Vec3; end: Vec3 }[] = []
    /**
     * A face being dragged along its normal.
     *
     * `committed` is false until the first parameter update of the gesture,
     * which is the one that records an undo step; every update after it amends.
     */
    let pushPull: {
      target: PushPullTarget
      origin: THREE.Vector3
      axis: THREE.Vector3
      startOffset: number
      committed: boolean
      /**
       * False until the pointer has travelled far enough to mean a drag.
       *
       * A press on a draggable face is ambiguous: it is the start of a pull, and
       * it is also how that feature gets selected. Waiting for movement lets a
       * plain click fall through to selection instead of committing a
       * zero-length drag and swallowing the click.
       */
      moved: boolean
    } | null = null
    const PUSH_PULL_THRESHOLD_PX = 3
    const filletSelectedSegments = new Map<string, { start: Vec3; end: Vec3 }[]>()
    const globalMeasurementReferenceCache = new Map<string, { geometryId: string; references: MeasurementReference[] }>()

    const transform = new TransformControls(camera, renderer.domElement)
    transform.setMode('translate')
    transform.setSize(0.82)
    transform.translationSnap = 1
    scene.add(transform.getHelper())

    let transformDragging = false
    transform.addEventListener('dragging-changed', (event) => {
      transformDragging = Boolean(event.value)
      orbit.enabled = !transformDragging
    })
    transform.addEventListener('mouseUp', () => {
      const object = transform.object
      if (!object) return
      const id = object.userData.featureId as string | undefined
      if (!id) return
      useDocumentStore.getState().setFeaturePosition(id, [object.position.x, object.position.y, object.position.z])
    })

    function referenceKey(reference: MeasurementReference | null) {
      return reference ? `${reference.featureId}:${reference.snapType}:${reference.point.map((value) => value.toFixed(4)).join(',')}` : 'none'
    }

    function updateMeasurement(next: MeasurementState) {
      measurement = next
      const key = `${referenceKey(next.hover)}|${referenceKey(next.start)}|${referenceKey(next.end)}`
      hoverMarker.visible = Boolean(next.hover)
      vertexHalo.visible = next.hover?.snapType === 'vertex'
      startMarker.visible = Boolean(next.start)
      endMarker.visible = Boolean(next.end)
      if (next.hover) {
        hoverMarker.position.set(...next.hover.point)
        vertexHalo.position.set(...next.hover.point)
        if (hoverMarker.material instanceof THREE.MeshBasicMaterial) hoverMarker.material.color.set(next.hover.snapType === 'vertex' ? '#9affd8' : '#f3d27d')
      }
      const hoveredEdge = next.hover?.edgeSegments
      edgeHighlight.visible = Boolean(hoveredEdge?.length)
      if (hoveredEdge?.length) {
        edgeHighlightGeometry.dispose()
        edgeHighlightGeometry = new LineSegmentsGeometry()
        edgeHighlightGeometry.setPositions(hoveredEdge.flatMap((segment) => [...segment.start, ...segment.end]))
        edgeHighlightGeometry.computeBoundingSphere()
        edgeHighlight.geometry = edgeHighlightGeometry
        edgeHighlightMaterial.color.set('#8ff0cc')
      }
      if (next.start) startMarker.position.set(...next.start.point)
      if (next.end) endMarker.position.set(...next.end.point)
      const lineEnd = next.end ?? (next.start ? next.hover : null)
      if (next.start && lineEnd) {
        measurementLineGeometry.setAttribute('position', new THREE.Float32BufferAttribute([...next.start.point, ...lineEnd.point], 3))
        measurementLineGeometry.computeBoundingSphere()
        measurementLine.computeLineDistances()
        measurementLine.visible = true
      } else measurementLine.visible = false
      measurementAngleArc.visible = false
      if (next.start && lineEnd) {
        const edgeDirection = measurementEdgeDirection(next.start)
        const origin = new THREE.Vector3(...next.start.point)
        const measurementDirection = new THREE.Vector3(...lineEnd.point).sub(origin)
        if (edgeDirection && measurementDirection.lengthSq() > 1e-12) {
          measurementDirection.normalize()
          let edgeVector = new THREE.Vector3(...edgeDirection).normalize()
          if (edgeVector.dot(measurementDirection) < 0) edgeVector = edgeVector.negate()
          const cosine = THREE.MathUtils.clamp(edgeVector.dot(measurementDirection), -1, 1)
          const angle = Math.acos(cosine)
          const perpendicular = measurementDirection.clone().addScaledVector(edgeVector, -cosine)
          if (angle > 1e-4 && perpendicular.lengthSq() > 1e-12) {
            perpendicular.normalize()
            const bounds = host.getBoundingClientRect()
            const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
              * camera.position.distanceTo(origin) / Math.max(1, bounds.height)
            const radius = worldPerPixel * 38
            const points = [origin.clone()]
            const steps = Math.max(8, Math.ceil(angle / (Math.PI / 36)))
            for (let index = 0; index <= steps; index += 1) {
              const theta = angle * index / steps
              points.push(origin.clone().addScaledVector(edgeVector, Math.cos(theta) * radius).addScaledVector(perpendicular, Math.sin(theta) * radius))
            }
            points.push(origin.clone())
            measurementAngleGeometry.setFromPoints(points)
            measurementAngleGeometry.computeBoundingSphere()
            measurementAngleArc.visible = true
          }
        }
      }
      host.dataset.measurementSnap = next.hover?.snapType ?? ''
      host.dataset.measurementVertexHighlight = next.hover?.snapType === 'vertex' ? 'active' : ''
      host.dataset.measurementEdgeHighlight = hoveredEdge?.length ? 'active' : ''
      measurementSnapBadge.hidden = !next.hover
      if (next.hover) {
        const screen = clientPoint(new THREE.Vector3(...next.hover.point))
        const bounds = host.getBoundingClientRect()
        const relative = next.start ? measurementRelativeEdgeAngles(next.start, next.start.point, next.hover.point) : null
        const orientation = next.start ? measurementLineOrientation(next.start.point, next.hover.point) : null
        const compactAngle = (angle: number) => `${Math.abs(angle - Math.round(angle)) < 0.05 ? angle.toFixed(0) : angle.toFixed(1)}°`
        const relativeLabel = relative ? ` · REL ${compactAngle(relative.smaller)}` : ''
        const absoluteLabel = orientation?.kind === 'planar' ? ` · ABS ${compactAngle(orientation.bearing)}` : ''
        measurementSnapBadge.textContent = `${next.hover.snapType.toUpperCase()} SNAP${relativeLabel}${absoluteLabel}`
        measurementSnapBadge.style.left = `${screen.x - bounds.left + 13}px`
        measurementSnapBadge.style.top = `${screen.y - bounds.top - 25}px`
      }
      if (key === measurementKey) return
      measurementKey = key
      onMeasurementChangeRef.current?.(next)
    }

    syncMeasurementModeRef.current = (active) => {
      if (!active) updateMeasurement({ hover: null, start: null, end: null })
    }

    function updateFilletHighlight() {
      const segments = [...filletSelectedSegments.values()].flat().concat(filletHoverSegments)
      edgeHighlight.visible = segments.length > 0
      if (!segments.length) return
      edgeHighlightGeometry.dispose()
      edgeHighlightGeometry = new LineSegmentsGeometry()
      edgeHighlightGeometry.setPositions(segments.flatMap((segment) => [...segment.start, ...segment.end]))
      edgeHighlightGeometry.computeBoundingSphere()
      edgeHighlight.geometry = edgeHighlightGeometry
      edgeHighlightMaterial.color.set('#ff4d4d')
    }

    function clearFilletHighlight(clearSelected = false) {
      filletHoverSegments = []
      if (clearSelected) filletSelectedSegments.clear()
      updateFilletHighlight()
    }

    function syncFilletEdges(edges: FilletEdgeReference[] | undefined) {
      filletSelectedSegments.clear()
      if (edges && edges.length && filletTargetIdRef.current) {
        const targetMesh = meshes.get(filletTargetIdRef.current)
        const exactIndex = targetMesh ? new ExactEdgeIndex(targetMesh.userData.kernelMesh) : null
        for (const ref of edges) {
          const matched = exactIndex?.findReferenceMatch(ref)
          const key = `${ref.start.join(',')}_${ref.end.join(',')}`
          if (matched) {
            filletSelectedSegments.set(key, [{ start: matched.start, end: matched.end }])
          } else {
            filletSelectedSegments.set(key, [{ start: ref.start, end: ref.end }])
          }
        }
      }
      updateFilletHighlight()
    }
    syncFilletEdgesRef.current = syncFilletEdges
    syncFilletEdges(filletEdgesRef.current)

    function clearFaceHighlight() {
      if (faceHighlight) {
        faceHighlight.removeFromParent()
        disposeObject(faceHighlight)
        faceHighlight = null
      }
      highlightedFaceKey = ''
      delete host.dataset.faceHighlight
    }

    function setHoverResult(result: SketchFacePickResult | null, key: string) {
      if (key === hoverResultKey) return
      hoverResultKey = key
      onSketchFaceHoverRef.current?.(result)
    }

    function coplanarFaceTriangles(hit: THREE.Intersection): [THREE.Vector3, THREE.Vector3, THREE.Vector3][] {
      if (!hit.face || !(hit.object instanceof THREE.Mesh)) return []
      const source = hit.object.geometry
      const positions = source.getAttribute('position')
      if (!positions) return []
      const targetNormal = hit.face.normal.clone().normalize()
      const targetPoint = new THREE.Vector3().fromBufferAttribute(positions, hit.face.a)
      const planeConstant = targetNormal.dot(targetPoint)
      const index = source.index
      const triangleCount = index ? index.count / 3 : positions.count / 3
      const triangles: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = []
      const a = new THREE.Vector3()
      const b = new THREE.Vector3()
      const c = new THREE.Vector3()
      const edgeA = new THREE.Vector3()
      const edgeB = new THREE.Vector3()
      const normal = new THREE.Vector3()
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const ia = index ? index.getX(triangle * 3) : triangle * 3
        const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
        const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
        a.fromBufferAttribute(positions, ia)
        b.fromBufferAttribute(positions, ib)
        c.fromBufferAttribute(positions, ic)
        edgeA.subVectors(b, a)
        edgeB.subVectors(c, a)
        normal.crossVectors(edgeA, edgeB).normalize()
        const coplanar = Math.abs(normal.dot(targetNormal)) > 0.9999
          && Math.abs(targetNormal.dot(a) - planeConstant) < 0.02
          && Math.abs(targetNormal.dot(b) - planeConstant) < 0.02
          && Math.abs(targetNormal.dot(c) - planeConstant) < 0.02
        if (coplanar) triangles.push([a.clone(), b.clone(), c.clone()])
      }
      return triangles
    }

    function describeFace(hit: THREE.Intersection, plane: SketchPlane, featureId: string, featureName: string, faceNormalSign: -1 | 1): SketchFaceAttachment {
      const triangles = coplanarFaceTriangles(hit)
      const edgeMap = new Map<string, { count: number; start: Vec2; end: Vec2 }>()
      const allPoints: Vec2[] = []
      let area = 0
      const quantized = (point: Vec2) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`
      for (const triangle of triangles) {
        const world = triangle.map((point) => point.clone().applyMatrix4(hit.object.matrixWorld)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
        area += world[1].clone().sub(world[0]).cross(world[2].clone().sub(world[0])).length() / 2
        const projected = world.map((point) => projectToSketchPlane(plane, point.toArray() as Vec3)) as [Vec2, Vec2, Vec2]
        allPoints.push(...projected)
        for (const [startIndex, endIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
          const start = projected[startIndex]
          const end = projected[endIndex]
          const startKey = quantized(start)
          const endKey = quantized(end)
          const key = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`
          const existing = edgeMap.get(key)
          if (existing) existing.count += 1
          else edgeMap.set(key, { count: 1, start, end })
        }
      }
      const fallback = projectToSketchPlane(plane, hit.point.toArray() as Vec3)
      const min: Vec2 = allPoints.length
        ? [Math.min(...allPoints.map((point) => point[0])), Math.min(...allPoints.map((point) => point[1]))]
        : fallback
      const max: Vec2 = allPoints.length
        ? [Math.max(...allPoints.map((point) => point[0])), Math.max(...allPoints.map((point) => point[1]))]
        : fallback
      const labels: Record<SketchPlane, [string, string]> = {
        XY: ['Bottom face', 'Top face'],
        XZ: ['Back face', 'Front face'],
        YZ: ['Left face', 'Right face'],
      }
      return {
        type: 'face',
        featureId,
        featureName,
        faceLabel: labels[plane][faceNormalSign > 0 ? 1 : 0],
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
        bounds: { min, max },
        edges: [...edgeMap.values()].filter((edge) => edge.count === 1).map(({ start, end }) => ({ start, end })),
        area,
      }
    }

    function classifySketchFace(hit: THREE.Intersection): SketchFacePickResult {
      if (!hit.face) return { ok: false, message: 'Choose a planar face on a visible solid.' }
      const featureId = hit.object.userData.featureId as string
      const feature = useDocumentStore.getState().document.features.find((candidate) => candidate.id === featureId)
      if (!feature || feature.kind === 'sketch' || feature.kind === 'sphere') {
        return { ok: false, message: 'That surface cannot host a sketch. Choose a flat face.' }
      }
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      const orientation = classifyFaceNormal(normal.toArray() as Vec3)
      if (!orientation) {
        return { ok: false, message: 'This version supports axis-aligned planar faces. Choose a top, front, or side face.' }
      }
      const { plane, faceNormalSign } = orientation
      if (feature.kind === 'cylinder' && plane !== 'XY') {
        return { ok: false, message: 'Choose one of the cylinder’s flat end caps.' }
      }
      const planeOffset = sketchPlaneOffset(plane, hit.point.toArray() as Vec3)
      const attachment = describeFace(hit, plane, feature.id, feature.name, faceNormalSign)
      return { ok: true, plane, planeOffset, faceNormalSign, featureName: feature.name, attachment }
    }

    function highlightFace(hit: THREE.Intersection, supported: boolean) {
      if (!hit.face || !(hit.object instanceof THREE.Mesh)) {
        clearFaceHighlight()
        return
      }
      const mesh = hit.object
      const source = mesh.geometry
      const positions = source.getAttribute('position')
      if (!positions) return
      const targetNormal = hit.face.normal.clone().normalize()
      const targetPoint = new THREE.Vector3().fromBufferAttribute(positions, hit.face.a)
      const planeConstant = targetNormal.dot(targetPoint)
      const key = `${mesh.userData.featureId}:${targetNormal.toArray().map((value) => value.toFixed(3)).join(',')}:${planeConstant.toFixed(3)}:${supported}`
      if (key === highlightedFaceKey) return
      clearFaceHighlight()

      const trianglePositions = coplanarFaceTriangles(hit).flatMap((triangle) => triangle.flatMap((point) => point.toArray()))
      if (!trianglePositions.length) return

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(trianglePositions, 3))
      geometry.computeVertexNormals()
      const color = supported ? '#69ddb2' : '#e08787'
      const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: supported ? 0.34 : 0.22, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }))
      fill.raycast = () => undefined
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }))
      edges.raycast = () => undefined
      faceHighlight = new THREE.Group()
      faceHighlight.renderOrder = 20
      faceHighlight.add(fill, edges)
      mesh.add(faceHighlight)
      highlightedFaceKey = key
      host.dataset.faceHighlight = supported ? 'supported' : 'unsupported'
    }

    function disposeModels() {
      clearFaceHighlight()
      transform.detach()
      disposeObject(modelGroup)
      modelGroup.clear()
      featureHighlight = null
      meshes.clear()
      sketchLines.clear()
      pendingGhosts.clear()
      delete host.dataset.pendingExact
      globalMeasurementReferenceCache.clear()
    }

    function addPendingGhost(feature: ExtrudeFeature | RevolveFeature, features: Feature[]) {
      const geometry = feature.kind === 'revolve'
        ? createRevolveToolGeometry(feature, features)
        : createExtrudeToolGeometry(feature, features)
      if (!geometry.getAttribute('position')?.count) {
        geometry.dispose()
        return
      }
      const removing = feature.operation === 'cut'
      const ghost = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: removing ? '#e08787' : '#7fe0b8',
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }))
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 28),
        new THREE.LineBasicMaterial({ color: removing ? '#f2b0b0' : '#9affd8', transparent: true, opacity: 0.9, depthTest: false }),
      )
      outline.raycast = () => undefined
      ghost.raycast = () => undefined
      ghost.add(outline)
      ghost.renderOrder = 15
      modelGroup.add(ghost)
      pendingGhosts.set(feature.id, ghost)
      host.dataset.pendingExact = feature.operation
    }

    function resolvePendingGhost(featureId: string) {
      const ghost = pendingGhosts.get(featureId)
      if (!ghost) return
      ghost.removeFromParent()
      disposeObject(ghost)
      pendingGhosts.delete(featureId)
      if (!pendingGhosts.size) delete host.dataset.pendingExact
    }

    function addSketchToScene(feature: Extract<Feature, { kind: 'sketch' }>, selected: boolean) {
      const positions: number[] = []
      const worldPoint = (u: number, v: number): [number, number, number] => {
        if (feature.plane === 'XZ') return [u, -feature.parameters.planeOffset, v]
        if (feature.plane === 'YZ') return [feature.parameters.planeOffset, u, v]
        return [u, v, feature.parameters.planeOffset]
      }
      for (const entity of feature.entities) {
        if (entity.type === 'line') {
          positions.push(...worldPoint(entity.start[0], entity.start[1]))
          positions.push(...worldPoint(entity.end[0], entity.end[1]))
        } else {
          // A circle is the whole turn; an arc is only the part it sweeps, so
          // both are drawn from a start angle and a span.
          const isArc = entity.type === 'arc'
          const from = isArc ? entity.startAngle : 0
          const span = isArc ? entity.endAngle - entity.startAngle : Math.PI * 2
          const segments = Math.max(8, Math.ceil((96 * span) / (Math.PI * 2)))
          for (let index = 0; index < segments; index += 1) {
            const angleA = from + (index / segments) * span
            const angleB = from + ((index + 1) / segments) * span
            positions.push(...worldPoint(entity.center[0] + Math.cos(angleA) * entity.radius, entity.center[1] + Math.sin(angleA) * entity.radius))
            positions.push(...worldPoint(entity.center[0] + Math.cos(angleB) * entity.radius, entity.center[1] + Math.sin(angleB) * entity.radius))
          }
        }
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const material = new THREE.LineBasicMaterial({ color: selected ? '#9affd8' : '#68a68f' })
      const lines = new THREE.LineSegments(geometry, material)
      lines.userData.featureId = feature.id
      modelGroup.add(lines)
      sketchLines.set(feature.id, lines)
    }

    function documentGeometrySignature() {
      return JSON.stringify(useDocumentStore.getState().document.features.map((feature) => ({
        id: feature.id,
        kind: feature.kind,
        visible: feature.visible,
        position: feature.position,
        rotation: feature.rotation,
        parameters: feature.parameters,
        ...(feature.kind === 'sketch' ? { plane: feature.plane, entities: feature.entities, attachment: feature.attachment } : {}),
        ...(feature.kind === 'extrude' || feature.kind === 'revolve' ? { sketchId: feature.sketchId, operation: feature.operation } : {}),
        ...(feature.kind === 'fillet' ? { edges: feature.edges } : {}),
      })))
    }

    function sampleFaces(geometry: THREE.BufferGeometry): { samples: FaceSample[]; groups: { start: number; count: number }[] } {
      const faceGroups = geometry.userData.faceGroups as { start: number; count: number; faceId: number }[] | undefined
      const positions = geometry.getAttribute('position')
      const normals = geometry.getAttribute('normal')
      const index = geometry.index
      if (!faceGroups?.length || !positions || !index) return { samples: [], groups: [] }

      const samples: FaceSample[] = []
      const groups: { start: number; count: number }[] = []
      for (const group of faceGroups) {
        const points: Vec3[] = []
        const seen: THREE.Vector3[] = []
        const step = Math.max(3, Math.floor(group.count / 24 / 3) * 3)
        for (let offset = group.start; offset + 2 < group.start + group.count; offset += step) {
          const vertex = new THREE.Vector3().fromBufferAttribute(positions, index.getX(offset))
          points.push(vertex.toArray() as Vec3)
          if (normals) seen.push(new THREE.Vector3().fromBufferAttribute(normals, index.getX(offset)))
        }
        if (!points.length) continue
        const planar = seen.every((normal) => normal.dot(seen[0]) > 0.999)
        samples.push({ points, planar })
        groups.push({ start: group.start, count: group.count })
      }
      return { samples, groups }
    }

    function updateFeatureHighlight(selectedId: string | null) {
      if (featureHighlight) {
        featureHighlight.removeFromParent()
        disposeObject(featureHighlight)
        featureHighlight = null
      }
      if (!selectedId) return
      const hostMesh = [...meshes.values()].at(-1)
      if (!hostMesh?.geometry.getAttribute('position')) return

      const { samples, groups } = sampleFaces(hostMesh.geometry)
      if (!samples.length) return
      const owners = attributeFaces(samples, useDocumentStore.getState().document.features)
      const owned = groups.filter((_, index) => owners[index] === selectedId)
      if (!owned.length) return

      const sourceIndex = hostMesh.geometry.index!
      const sourcePositions = hostMesh.geometry.getAttribute('position')
      const sourceNormals = hostMesh.geometry.getAttribute('normal')
      const positions: number[] = []
      const normals: number[] = []
      for (const group of owned) {
        for (let offset = group.start; offset < group.start + group.count; offset += 1) {
          const vertex = sourceIndex.getX(offset)
          positions.push(sourcePositions.getX(vertex), sourcePositions.getY(vertex), sourcePositions.getZ(vertex))
          if (sourceNormals) normals.push(sourceNormals.getX(vertex), sourceNormals.getY(vertex), sourceNormals.getZ(vertex))
        }
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      if (normals.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))

      featureHighlight = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: '#76e2ba',
        emissive: '#2f9e78',
        emissiveIntensity: 0.55,
        roughness: 0.42,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }))
      featureHighlight.raycast = () => undefined
      featureHighlight.renderOrder = 4
      modelGroup.add(featureHighlight)
    }

    function updateSelection() {
      const state = useDocumentStore.getState()
      const selectedId = state.selectedId
      const sketching = Boolean(state.activeSketchId)
      transform.detach()
      const wholeBodyKinds = new Set(['box', 'cylinder', 'sphere'])
      const selectedIsWholeBody = Boolean(selectedId
        && wholeBodyKinds.has(state.document.features.find((candidate) => candidate.id === selectedId)?.kind ?? ''))

      for (const [id, mesh] of meshes) {
        const provisional = pendingGhosts.has(id)
        const tinted = selectedIsWholeBody && id === selectedId
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.color.set(tinted ? '#76e2ba' : sketching ? '#93a49d' : '#b8c7c1')
          mesh.material.transparent = sketching || provisional
          mesh.material.opacity = provisional ? 0.5 : sketching ? 0.68 : 1
        }
        const edge = mesh.children[0]
        if (edge instanceof LineSegments2) {
          setEdgeAppearance(
            edge,
            tinted ? '#d8fff0' : sketching ? '#5f7a6f' : '#1b2320',
            tinted ? 0.95 : sketching ? 0.6 : 0.82,
            tinted,
          )
        }
      }
      updateFeatureHighlight(sketching || selectedIsWholeBody ? null : selectedId)
      for (const [id, lines] of sketchLines) {
        if (lines.material instanceof THREE.LineBasicMaterial) lines.material.color.set(id === selectedId ? '#9affd8' : '#68a68f')
      }
      const selectedMesh = selectedId ? meshes.get(selectedId) : undefined
      const selectedFeature = selectedId ? state.document.features.find(f => f.id === selectedId) : undefined
      const isPrimitive = selectedFeature?.kind === 'box' || selectedFeature?.kind === 'cylinder' || selectedFeature?.kind === 'sphere'
      if (selectedMesh && isPrimitive && !sketching && !pickSketchFaceRef.current && !measureModeRef.current && !filletTargetIdRef.current) transform.attach(selectedMesh)
    }

    function fitLightingToModel() {
      const box = new THREE.Box3().setFromObject(modelGroup)
      if (box.isEmpty()) return
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      if (sphere.radius > 0.001) {
        controller.updateLightingForBounds(sphere.center, sphere.radius)
      }
    }

    function rebuild() {
      const generation = ++rebuildGeneration
      disposeModels()
      const state = useDocumentStore.getState()
      geometrySignature = documentGeometrySignature()
      const plan = planSolidRender(state.document.features)
      for (const feature of state.document.features) {
        if (!feature.visible) continue
        if (isSolid(feature) && !plan.rendered.has(feature.id)) continue
        const selected = feature.id === state.selectedId
        if (feature.kind === 'sketch') {
          addSketchToScene(feature, selected)
          continue
        }
        const geometry = feature.kind === 'fillet'
          ? new THREE.BufferGeometry()
          : createPreviewGeometry(feature, state.document.features)
        const material = new THREE.MeshStandardMaterial({
          color: selected ? '#76e2ba' : '#b8c7c1',
          roughness: 0.58,
          metalness: 0.08,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(...feature.position)
        mesh.rotation.set(...feature.rotation)
        mesh.userData.featureId = feature.id

        const previewEdges = geometry.getAttribute('position')
          ? new THREE.EdgesGeometry(geometry, 28)
          : new THREE.BufferGeometry()
        const previewPositions = previewEdges.getAttribute('position')
        const edges = createModelEdges(
          mesh,
          previewPositions
            ? new THREE.Float32BufferAttribute(Array.from(previewPositions.array), 3)
            : new THREE.Float32BufferAttribute([], 3),
          selected ? '#d8fff0' : '#1b2320',
          selected ? 0.95 : 0.82,
          selected,
        )
        previewEdges.dispose()
        mesh.add(edges)
        modelGroup.add(mesh)
        meshes.set(feature.id, mesh)

        if (isSolid(feature)) {
          const sketch = feature.kind === 'extrude' || feature.kind === 'revolve'
            ? state.document.features.find((candidate) => candidate.id === feature.sketchId)
            : undefined
          if (feature.kind !== 'fillet' && feature.operation !== 'newBody') addPendingGhost(feature, state.document.features)
          if (feature.kind === 'fillet' || sketch?.kind === 'sketch') {
            void evaluateExactExtrude(feature, sketch?.kind === 'sketch' ? sketch : undefined, state.document.features).then((exactMesh) => {
              if (generation !== rebuildGeneration || meshes.get(feature.id) !== mesh) return
              for (const supersededId of plan.supersedes.get(feature.id) ?? []) {
                const previousMesh = meshes.get(supersededId)
                if (!previousMesh) continue
                previousMesh.removeFromParent()
                disposeObject(previousMesh)
                meshes.delete(supersededId)
              }
              resolvePendingGhost(feature.id)
              mesh.geometry.dispose()
              mesh.geometry = kernelMeshToGeometry(exactMesh)
              const oldEdges = mesh.children[0]
              if (oldEdges instanceof LineSegments2) {
                updateModelEdges(mesh, oldEdges, exactMesh.edgeLines, exactMesh.edgeGroups)
              }
              updateSelection()
              fitLightingToModel()
            }).catch(() => {})
          }
        }
      }

      updateSelection()
      fitLightingToModel()
    }

    rebuild()

    const unsubscribeViewport = useViewportStore.subscribe((state) => controller.setBrightness(state.brightness))
    const unsubscribe = useDocumentStore.subscribe((state, previous) => {
      if (state.document !== previous.document) {
        const nextSignature = documentGeometrySignature()
        if (nextSignature !== geometrySignature) rebuild()
        else updateSelection()
      } else if (state.selectedId !== previous.selectedId || state.activeSketchId !== previous.activeSketchId) updateSelection()
      if (state.activeSketchId !== previous.activeSketchId && state.activeSketchId) {
        const sketch = state.document.features.find((feature) => feature.id === state.activeSketchId)
        if (sketch?.kind === 'sketch') controller.setSketchPlaneView(sketch.plane, sketch.parameters.planeOffset, sketch.attachment?.center, host.getBoundingClientRect().height)
      }
    })

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const pointerDown = new THREE.Vector2()

    function pointerCoordinates(event: PointerEvent) {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      )
    }

    function clientPoint(point: THREE.Vector3) {
      const bounds = renderer.domElement.getBoundingClientRect()
      const projected = point.clone().project(camera)
      return new THREE.Vector2(
        bounds.left + (projected.x + 1) * bounds.width / 2,
        bounds.top + (1 - projected.y) * bounds.height / 2,
      )
    }

    function measurementReference(event: PointerEvent, hit: THREE.Intersection): MeasurementReference | null {
      if (!(hit.object instanceof THREE.Mesh)) return null
      const mesh = hit.object
      const featureId = mesh.userData.featureId as string | undefined
      const feature = useDocumentStore.getState().document.features.find((candidate) => candidate.id === featureId)
      if (!feature) return null
      const cursor = new THREE.Vector2(event.clientX, event.clientY)
      const snapRadius = MEASUREMENT_SNAP_RADIUS_PX
      const candidates: { point: THREE.Vector3; snapType: MeasurementSnapType; distance: number; radius?: number; edgeSegments?: { start: Vec3; end: Vec3 }[] }[] = []
      const addCandidate = (point: THREE.Vector3, snapType: MeasurementSnapType, distance = clientPoint(point).distanceTo(cursor), radius?: number, edgeSegments?: { start: Vec3; end: Vec3 }[]) => {
        if (distance <= snapRadius) candidates.push({ point, snapType, distance, radius, edgeSegments })
      }

      const faceTriangles = coplanarFaceTriangles(hit)
      if (faceTriangles.length >= 2) {
        const faceBounds = new THREE.Box3()
        faceTriangles.flat().forEach((point) => faceBounds.expandByPoint(point.clone().applyMatrix4(mesh.matrixWorld)))
        addCandidate(faceBounds.getCenter(new THREE.Vector3()), 'face center')
      }

      mesh.geometry.computeBoundingBox()
      if (mesh.geometry.boundingBox) {
        addCandidate(mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld), 'feature center')
      }

      // Read where the edges are from the solid's edge source, not from the
      // object that draws them: how edges are rendered must not decide what can
      // be snapped to. See `model-edges.ts`.
      const edgeSource = edgeSourceOf(mesh)
      if (edgeSource) {
        mesh.updateWorldMatrix(true, false)
        const edgeMatrix = mesh.matrixWorld
        const positions = edgeSource.positions
        const segments: { start: THREE.Vector3; end: THREE.Vector3; startKey: string; endKey: string; startIndex: number }[] = []
        const endpointCounts = new Map<string, number>()
        const pointKey = (point: THREE.Vector3) => point.toArray().map((value) => value.toFixed(4)).join(',')
        for (let index = 0; index + 1 < positions.count; index += 2) {
          const start = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(edgeMatrix)
          const end = new THREE.Vector3().fromBufferAttribute(positions, index + 1).applyMatrix4(edgeMatrix)
          const startKey = pointKey(start)
          const endKey = pointKey(end)
          endpointCounts.set(startKey, (endpointCounts.get(startKey) ?? 0) + 1)
          endpointCounts.set(endKey, (endpointCounts.get(endKey) ?? 0) + 1)
          segments.push({ start, end, startKey, endKey, startIndex: index })
        }
        const edgeGroups = edgeSource.edgeGroups
        const groupSegmentCache = new Map<number, { start: Vec3; end: Vec3 }[]>()
        const highlightedSegments = (segment: typeof segments[number]) => {
          const group = edgeGroups?.find((candidate) => segment.startIndex >= candidate.start && segment.startIndex < candidate.start + candidate.count)
          if (!group) return [{ start: segment.start.toArray() as Vec3, end: segment.end.toArray() as Vec3 }]
          const existing = groupSegmentCache.get(group.start)
          if (existing) return existing
          const result: { start: Vec3; end: Vec3 }[] = []
          for (let index = group.start; index + 1 < group.start + group.count; index += 2) {
            result.push({
              start: new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(edgeMatrix).toArray() as Vec3,
              end: new THREE.Vector3().fromBufferAttribute(positions, index + 1).applyMatrix4(edgeMatrix).toArray() as Vec3,
            })
          }
          groupSegmentCache.set(group.start, result)
          return result
        }
        if (edgeGroups?.length) {
          for (const group of edgeGroups) {
            if (group.count < 2 || group.start < 0 || group.start + group.count > positions.count) continue
            const start = new THREE.Vector3().fromBufferAttribute(positions, group.start).applyMatrix4(edgeMatrix)
            const end = new THREE.Vector3().fromBufferAttribute(positions, group.start + group.count - 1).applyMatrix4(edgeMatrix)
            if (start.distanceTo(end) < 0.001) continue
            addCandidate(start, 'vertex')
            addCandidate(end, 'vertex')
          }
        }
        for (const segment of segments) {
          if (!edgeGroups?.length && endpointCounts.get(segment.startKey) !== 2) addCandidate(segment.start, 'vertex')
          if (!edgeGroups?.length && endpointCounts.get(segment.endKey) !== 2) addCandidate(segment.end, 'vertex')
          const edgeSegments = highlightedSegments(segment)
          addCandidate(segment.start.clone().lerp(segment.end, 0.5), 'edge midpoint', undefined, undefined, edgeSegments)
          const screenStart = clientPoint(segment.start)
          const screenEnd = clientPoint(segment.end)
          const screenDelta = screenEnd.clone().sub(screenStart)
          const lengthSquared = screenDelta.lengthSq()
          const position = lengthSquared < 1e-9 ? 0 : THREE.MathUtils.clamp(cursor.clone().sub(screenStart).dot(screenDelta) / lengthSquared, 0, 1)
          const screenClosest = screenStart.clone().lerp(screenEnd, position)
          addCandidate(segment.start.clone().lerp(segment.end, position), 'edge', screenClosest.distanceTo(cursor), undefined, edgeSegments)
        }
      }

      // Discrete design-intent targets win once acquired. Sorting only by
      // cursor distance made the continuously moving edge projection beat a
      // nearby corner or midpoint unless the pointer was pixel-perfect.
      candidates.sort(compareMeasurementSnapCandidates)
      const selected: typeof candidates[number] = candidates[0] ?? { point: hit.point, snapType: 'surface', distance: 0 }
      return {
        point: selected.point.toArray() as Vec3,
        featureId: feature.id,
        featureName: feature.name,
        featureKind: feature.kind,
        snapType: selected.snapType,
        ...(selected.radius === undefined ? {} : { radius: selected.radius }),
        ...(selected.edgeSegments?.length ? { edgeSegments: selected.edgeSegments } : {}),
      }
    }

    function globalMeasurementReference(event: PointerEvent): MeasurementReference | null {
      const cursor = new THREE.Vector2(event.clientX, event.clientY)
      let closest: { reference: MeasurementReference; distance: number } | null = null
      for (const [featureId, mesh] of meshes) {
        const feature = useDocumentStore.getState().document.features.find((candidate) => candidate.id === featureId)
        if (!feature) continue
        const edgeSource = edgeSourceOf(mesh)
        if (!edgeSource) continue
        // Keyed on the edge data itself rather than on a rendered geometry's
        // uuid, so the cache invalidates when the edges change and not when the
        // way they are drawn changes.
        const geometryId = edgeSource.id
        let cached = globalMeasurementReferenceCache.get(featureId)
        if (!cached || cached.geometryId !== geometryId) {
          mesh.updateWorldMatrix(true, false)
          const edgeMatrix = mesh.matrixWorld
          const positions = edgeSource.positions
          const segments: { start: Vec3; end: Vec3 }[] = []
          for (let index = 0; index + 1 < positions.count; index += 2) {
            segments.push({
              start: new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(edgeMatrix).toArray() as Vec3,
              end: new THREE.Vector3().fromBufferAttribute(positions, index + 1).applyMatrix4(edgeMatrix).toArray() as Vec3,
            })
          }
          const references: MeasurementReference[] = findCircularLoopCenters(segments).map((loop) => ({
            point: loop.center,
            featureId: feature.id,
            featureName: feature.name,
            featureKind: feature.kind,
            snapType: 'hole center',
            radius: loop.radius,
          }))
          const edgeGroups = edgeSource.edgeGroups
          const vertexKeys = new Set<string>()
          const midpointKeys = new Set<string>()
          const addVertex = (point: Vec3) => {
            const key = point.map((value) => value.toFixed(4)).join(',')
            if (vertexKeys.has(key)) return
            vertexKeys.add(key)
            references.push({
              point,
              featureId: feature.id,
              featureName: feature.name,
              featureKind: feature.kind,
              snapType: 'vertex',
            })
          }
          const addMidpoint = (edgeSegments: { start: Vec3; end: Vec3 }[]) => {
            const totalLength = edgeSegments.reduce((sum, segment) => sum + Math.hypot(
              segment.end[0] - segment.start[0],
              segment.end[1] - segment.start[1],
              segment.end[2] - segment.start[2],
            ), 0)
            let remaining = totalLength / 2
            for (const segment of edgeSegments) {
              const length = Math.hypot(
                segment.end[0] - segment.start[0],
                segment.end[1] - segment.start[1],
                segment.end[2] - segment.start[2],
              )
              if (remaining <= length || segment === edgeSegments.at(-1)) {
                const ratio = length < 1e-9 ? 0 : remaining / length
                const point: Vec3 = [
                  segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
                  segment.start[1] + (segment.end[1] - segment.start[1]) * ratio,
                  segment.start[2] + (segment.end[2] - segment.start[2]) * ratio,
                ]
                const key = point.map((value) => value.toFixed(4)).join(',')
                if (!midpointKeys.has(key)) {
                  midpointKeys.add(key)
                  references.push({
                    point,
                    featureId: feature.id,
                    featureName: feature.name,
                    featureKind: feature.kind,
                    snapType: 'edge midpoint',
                    edgeSegments,
                  })
                }
                return
              }
              remaining -= length
            }
          }
          if (edgeGroups?.length) {
            for (const group of edgeGroups) {
              if (group.count < 2 || group.start < 0 || group.start + group.count > positions.count) continue
              const start = new THREE.Vector3().fromBufferAttribute(positions, group.start).applyMatrix4(edgeMatrix).toArray() as Vec3
              const end = new THREE.Vector3().fromBufferAttribute(positions, group.start + group.count - 1).applyMatrix4(edgeMatrix).toArray() as Vec3
              if (Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]) < 0.001) continue
              addVertex(start)
              addVertex(end)
              addMidpoint(segments.slice(group.start / 2, (group.start + group.count) / 2))
            }
          } else {
            for (const segment of segments) {
              addVertex(segment.start)
              addVertex(segment.end)
              addMidpoint([segment])
            }
          }
          cached = { geometryId, references }
          globalMeasurementReferenceCache.set(featureId, cached)
        }
        for (const reference of cached.references) {
          const distance = clientPoint(new THREE.Vector3(...reference.point)).distanceTo(cursor)
          const winsTie = closest && Math.abs(distance - closest.distance) < 0.5 && reference.snapType === 'vertex' && closest.reference.snapType !== 'vertex'
          if (distance <= MEASUREMENT_SNAP_RADIUS_PX && (!closest || distance < closest.distance || winsTie)) closest = { reference, distance }
        }
      }
      return closest?.reference ?? null
    }

    function filletEdgeReference(event: PointerEvent, mesh: THREE.Mesh): { edge: FilletEdgeReference; segments: { start: Vec3; end: Vec3 }[]; key: string } | null {
      const edgeSource = edgeSourceOf(mesh)
      if (!edgeSource) return null
      mesh.updateWorldMatrix(true, false)
      const edgeMatrix = mesh.matrixWorld
      const positions = edgeSource.positions
      if (!positions || positions.count < 2) return null
      const cursor = new THREE.Vector2(event.clientX, event.clientY)
      let closest: { index: number; distance: number } | null = null
      for (let index = 0; index + 1 < positions.count; index += 2) {
        const start = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(edgeMatrix)
        const end = new THREE.Vector3().fromBufferAttribute(positions, index + 1).applyMatrix4(edgeMatrix)
        const screenStart = clientPoint(start)
        const screenEnd = clientPoint(end)
        const delta = screenEnd.clone().sub(screenStart)
        const lengthSquared = delta.lengthSq()
        const fraction = lengthSquared < 1e-9 ? 0 : THREE.MathUtils.clamp(cursor.clone().sub(screenStart).dot(delta) / lengthSquared, 0, 1)
        const screenPoint = screenStart.clone().lerp(screenEnd, fraction)
        const distance = screenPoint.distanceTo(cursor)
        if (!closest || distance < closest.distance) closest = { index, distance }
      }
      if (!closest || closest.distance > 20) return null
      const groups = edgeSource.edgeGroups as ({ start: number; count: number } | null | undefined)[] | undefined
      const group = groups?.find((candidate) => Boolean(candidate) && closest!.index >= candidate!.start && closest!.index < candidate!.start + candidate!.count) ?? undefined
      const startIndex = group?.start ?? closest.index
      const endIndex = group ? group.start + group.count - 1 : closest.index + 1
      const segments: { start: Vec3; end: Vec3 }[] = []
      const segmentEnd = group ? group.start + group.count : closest.index + 2
      let totalLength = 0
      for (let index = startIndex; index + 1 < segmentEnd; index += 2) {
        const start = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(edgeMatrix)
        const end = new THREE.Vector3().fromBufferAttribute(positions, index + 1).applyMatrix4(edgeMatrix)
        totalLength += start.distanceTo(end)
        segments.push({ start: start.toArray() as Vec3, end: end.toArray() as Vec3 })
      }
      let remaining = totalLength / 2
      let midpoint = new THREE.Vector3(...segments[0].start)
      for (const segment of segments) {
        const start = new THREE.Vector3(...segment.start)
        const end = new THREE.Vector3(...segment.end)
        const length = start.distanceTo(end)
        if (remaining <= length || segment === segments.at(-1)) {
          midpoint = start.lerp(end, length < 1e-9 ? 0 : remaining / length)
          break
        }
        remaining -= length
      }
      const start = new THREE.Vector3().fromBufferAttribute(positions, startIndex).applyMatrix4(edgeMatrix).toArray() as Vec3
      const end = new THREE.Vector3().fromBufferAttribute(positions, endIndex).applyMatrix4(edgeMatrix).toArray() as Vec3
      const key = [start, end].map((point) => point.map((value) => value.toFixed(4)).join(',')).sort().join('|')
      return { edge: { point: midpoint.toArray() as Vec3, start, end }, segments, key }
    }

    /**
     * The face a raycast landed on, as an ownership sample in world space.
     *
     * `faceIndex` counts triangles; face groups are measured in index-buffer
     * offsets, three per triangle, which is where the multiply comes from.
     */
    function faceSampleAt(mesh: THREE.Mesh, faceIndex: number): FaceSample | null {
      const geometry = mesh.geometry
      const groups = geometry.userData.faceGroups as { start: number; count: number }[] | undefined
      const positions = geometry.getAttribute('position')
      const normals = geometry.getAttribute('normal')
      const index = geometry.index
      if (!groups?.length || !positions || !index) return null

      const offset = faceIndex * 3
      const group = groups.find((candidate) => offset >= candidate.start && offset < candidate.start + candidate.count)
      if (!group) return null

      mesh.updateWorldMatrix(true, false)
      const points: Vec3[] = []
      const seen: THREE.Vector3[] = []
      const step = Math.max(3, Math.floor(group.count / 24 / 3) * 3)
      for (let at = group.start; at + 2 < group.start + group.count; at += step) {
        const vertex = index.getX(at)
        points.push(new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld).toArray() as Vec3)
        if (normals) seen.push(new THREE.Vector3().fromBufferAttribute(normals, vertex))
      }
      if (!points.length) return null
      return { points, planar: seen.every((normal) => normal.dot(seen[0]) > 0.999) }
    }

    /** What dragging the face under the pointer would edit, if anything. */
    function pushPullTargetAt(event: PointerEvent): { target: PushPullTarget; hit: THREE.Intersection } | null {
      pointerCoordinates(event)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects([...meshes.values()], false)[0]
      if (!hit?.face || hit.faceIndex == null || !(hit.object instanceof THREE.Mesh)) return null
      const sample = faceSampleAt(hit.object, hit.faceIndex)
      if (!sample) return null
      const target = pushPullTargetForFace(sample, useDocumentStore.getState().document.features)
      return target ? { target, hit } : null
    }

    /**
     * How far along a world axis the pointer has travelled since the drag began.
     *
     * The pointer moves in two dimensions and the face moves in one, so the
     * cursor ray is closed onto the drag axis: the answer is the point on the
     * axis nearest the ray. Where the ray is nearly parallel to the axis that
     * closest point races off to infinity, so those frames are dropped and the
     * face simply holds still rather than leaping.
     */
    function distanceAlongAxis(event: PointerEvent, origin: THREE.Vector3, axis: THREE.Vector3): number | null {
      pointerCoordinates(event)
      raycaster.setFromCamera(pointer, camera)
      const ray = raycaster.ray
      const cross = new THREE.Vector3().crossVectors(axis, ray.direction)
      const denominator = cross.lengthSq()
      if (denominator < 1e-6) return null
      const between = new THREE.Vector3().subVectors(ray.origin, origin)
      return new THREE.Vector3().crossVectors(between, ray.direction).dot(cross) / denominator
    }

    /** Finish a gesture. Returns true when it was a real drag, not a click. */
    function endPushPull(): boolean {
      if (!pushPull) return false
      const dragged = pushPull.moved
      pushPull = null
      orbit.enabled = true
      delete host.dataset.pushPull
      if (dragged) updateSelection()
      return dragged
    }

    function onPointerDown(event: PointerEvent) {
      pointerDown.set(event.clientX, event.clientY)
      if (event.button !== 0 || transformDragging) return
      if (pickSketchFaceRef.current || measureModeRef.current || filletTargetIdRef.current) return
      if (useDocumentStore.getState().activeSketchId) return

      const picked = pushPullTargetAt(event)
      if (!picked) return
      const axis = new THREE.Vector3(...picked.target.axis).normalize()
      const origin = picked.hit.point.clone()
      const start = distanceAlongAxis(event, origin, axis)
      if (start === null) return

      pushPull = { target: picked.target, origin, axis, startOffset: start, committed: false, moved: false }
    }

    /**
     * Apply a drag to the feature that owns the dragged face.
     *
     * The first update of a gesture records history and every one after it
     * amends, so the whole drag collapses to a single undo step. The exact solid
     * re-evaluates from the change like any other parameter edit — resuming from
     * the prefix cache, which is what makes this feel immediate on a part with
     * real history behind it.
     */
    function onPushPullMove(event: PointerEvent) {
      if (!pushPull) return
      if (!pushPull.moved) {
        if (pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) <= PUSH_PULL_THRESHOLD_PX) return
        pushPull.moved = true
        orbit.enabled = false
        host.dataset.pushPull = 'dragging'
        // Capture keeps the gesture alive past the edge of the canvas, but a
        // browser may refuse an id it no longer considers active. The drag still
        // ends on pointerup or pointercancel either way.
        try {
          renderer.domElement.setPointerCapture(event.pointerId)
        } catch {
          // Not fatal; the drag simply ends if the pointer leaves the canvas.
        }
      }
      const now = distanceAlongAxis(event, pushPull.origin, pushPull.axis)
      if (now === null) return

      const travelled = now - pushPull.startOffset
      const snap = sketchSnapIncrement(useDocumentStore.getState().document.displayUnits ?? 'mm')
      const snapped = event.shiftKey ? travelled : Math.round(travelled / snap) * snap
      const distance = clampPulledDistance(distanceAfterPull(pushPull.target, snapped), pushPull.target.distance)

      useDocumentStore.getState().updateParameters(
        pushPull.target.featureId,
        { distance },
        { amend: pushPull.committed },
      )
      pushPull.committed = true
    }

    function onPointerMove(event: PointerEvent) {
      if (pushPull) {
        onPushPullMove(event)
        return
      }
      if (measureModeRef.current) {
        pointerCoordinates(event)
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects([...meshes.values()], false)[0]
        updateMeasurement({ ...measurement, hover: globalMeasurementReference(event) ?? (hit ? measurementReference(event, hit) : null) })
        return
      }
      if (filletTargetIdRef.current) {
        const targetMesh = meshes.get(filletTargetIdRef.current)
        const picked = targetMesh ? filletEdgeReference(event, targetMesh) : null
        filletHoverSegments = picked?.segments ?? []
        updateFilletHighlight()
        if (picked) {
          hoverMarker.position.set(...picked.edge.point)
          hoverMarker.visible = true
        } else {
          hoverMarker.visible = false
        }
        return
      } else if (filletSelectedSegments.size > 0 || filletHoverSegments.length > 0) {
        clearFilletHighlight(true)
      }
      if (!pickSketchFaceRef.current) {
        // Idle: show which faces can be dragged, so push/pull is discoverable
        // without a mode to enter first.
        if (useDocumentStore.getState().activeSketchId || transform.axis) return
        const picked = pushPullTargetAt(event)
        if (picked) {
          highlightFace(picked.hit, true)
          host.dataset.pushPull = 'available'
        } else if (host.dataset.pushPull === 'available') {
          clearFaceHighlight()
          delete host.dataset.pushPull
        }
        return
      }
      pointerCoordinates(event)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects([...meshes.values()], false)[0]
      if (!hit?.face) {
        clearFaceHighlight()
        setHoverResult(null, 'none')
        return
      }
      const result = classifySketchFace(hit)
      highlightFace(hit, result.ok)
      const key = result.ok
        ? `ok:${result.featureName}:${result.plane}:${result.planeOffset.toFixed(3)}:${result.faceNormalSign}`
        : `error:${result.message}`
      setHoverResult(result, key)
    }

    function onPointerLeave() {
      if (pushPull) return
      if (host.dataset.pushPull === 'available') {
        clearFaceHighlight()
        delete host.dataset.pushPull
      }
      if (measureModeRef.current) {
        updateMeasurement({ ...measurement, hover: null })
        return
      }
      if (filletTargetIdRef.current) {
        clearFilletHighlight()
        hoverMarker.visible = false
        return
      }
      if (!pickSketchFaceRef.current) return
      clearFaceHighlight()
      setHoverResult(null, 'none')
    }

    function onPointerUp(event: PointerEvent) {
      if (pushPull) {
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId)
        }
        // A press that never moved is a click on that face: fall through so it
        // selects the feature, exactly as clicking anywhere else on the solid does.
        if (endPushPull()) return
      }
      if (transformDragging || pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 4) return
      if (transform.axis && !pickSketchFaceRef.current && !measureModeRef.current && !filletTargetIdRef.current) return
      pointerCoordinates(event)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects([...meshes.values()], false)
      if (filletTargetIdRef.current) {
        const targetMesh = meshes.get(filletTargetIdRef.current)
        const picked = targetMesh ? filletEdgeReference(event, targetMesh) : null
        if (picked) {
          filletHoverSegments = []
          onFilletEdgePickRef.current?.({ featureId: filletTargetIdRef.current, edge: picked.edge })
        } else onFilletEdgeMissRef.current?.()
        return
      }
      if (measureModeRef.current) {
        const hit = hits[0]
        const reference = globalMeasurementReference(event) ?? (hit ? measurementReference(event, hit) : null)
        if (!reference) return
        if (!measurement.start || measurement.end) updateMeasurement({ hover: reference, start: reference, end: null })
        else updateMeasurement({ hover: reference, start: measurement.start, end: reference })
        return
      }
      if (pickSketchFaceRef.current) {
        const hit = hits[0]
        const result = hit ? classifySketchFace(hit) : { ok: false as const, message: 'Choose a planar face on a visible solid.' }
        if (result.ok) clearFaceHighlight()
        onSketchFacePickRef.current?.(result)
        return
      }
      const id = hits[0]?.object.userData.featureId as string | undefined
      useDocumentStore.getState().select(id ?? null)
    }

    function onSetView(event: Event) {
      controller.setCameraView((event as CustomEvent<CameraView>).detail)
    }
    function onRollView(event: Event) {
      controller.rollCamera((event as CustomEvent<number>).detail)
    }
    function onReverseView() {
      controller.reverseView()
    }
    function onLookAtNormal(event: Event) {
      const detail = (event as CustomEvent<{ normal: [number, number, number]; center?: [number, number, number] }>).detail
      controller.lookAtNormal(detail.normal, detail.center)
    }
    function onSetViewDirection(event: Event) {
      const detail = (event as CustomEvent<{ direction: [number, number, number]; up?: [number, number, number] }>).detail
      controller.setCustomViewDirection(detail.direction, detail.up)
    }
    window.addEventListener('parallax:set-view', onSetView)
    window.addEventListener('parallax:set-view-direction', onSetViewDirection)
    window.addEventListener('parallax:roll-view', onRollView)
    window.addEventListener('parallax:reverse-view', onReverseView)
    window.addEventListener('parallax:look-at-normal', onLookAtNormal)

    renderer.domElement.addEventListener('pointercancel', endPushPull)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)

    const initialSketchId = useDocumentStore.getState().activeSketchId
    const initialSketch = useDocumentStore.getState().document.features.find((feature) => feature.id === initialSketchId)
    if (initialSketch?.kind === 'sketch') {
      controller.setSketchPlaneView(initialSketch.plane, initialSketch.parameters.planeOffset, initialSketch.attachment?.center, host.getBoundingClientRect().height)
    }

    return () => {
      unsubscribe()
      unsubscribeViewport()
      window.removeEventListener('parallax:set-view', onSetView)
      window.removeEventListener('parallax:set-view-direction', onSetViewDirection)
      window.removeEventListener('parallax:roll-view', onRollView)
      window.removeEventListener('parallax:reverse-view', onReverseView)
      window.removeEventListener('parallax:look-at-normal', onLookAtNormal)
      renderer.domElement.removeEventListener('pointercancel', endPushPull)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      disposeModels()
      syncMeasurementModeRef.current = null
      measurementSnapBadge.remove()
      markerGeometry.dispose()
      for (const marker of [hoverMarker, vertexHalo, startMarker, endMarker]) {
        if (marker.material instanceof THREE.Material) marker.material.dispose()
      }
      measurementLineGeometry.dispose()
      if (measurementLine.material instanceof THREE.Material) measurementLine.material.dispose()
      measurementAngleGeometry.dispose()
      if (measurementAngleArc.material instanceof THREE.Material) measurementAngleArc.material.dispose()
      edgeHighlightGeometry.dispose()
      if (edgeHighlight.material instanceof THREE.Material) edgeHighlight.material.dispose()
      transform.dispose()
      controller.dispose()
    }
  }, [])

  return <div ref={hostRef} className={`viewport-canvas${pickSketchFace ? ' face-picking' : ''}${measureMode ? ' measuring' : ''}`} aria-label="3D modeling viewport" />
}
