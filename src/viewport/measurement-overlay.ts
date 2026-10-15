import * as THREE from 'three'
import {
  measurementEdgeDirection,
  measurementLineOrientation,
  measurementRelativeEdgeAngles,
  type MeasurementReference,
  type MeasurementState,
} from '../core/measurement'
import type { Vec3 } from '../core/model'
import type { EdgeHighlight } from './edge-highlight'
import type { ViewportPicker } from './viewport-picker'

const EMPTY: MeasurementState = { hover: null, start: null, end: null }

/** On-screen radius of the angle arc drawn at a measurement's start, in pixels. */
const ANGLE_ARC_RADIUS_PX = 38

function referenceKey(reference: MeasurementReference | null) {
  return reference ? `${reference.featureId}:${reference.snapType}:${reference.point.map((value) => value.toFixed(4)).join(',')}` : 'none'
}

const compactAngle = (angle: number) => `${Math.abs(angle - Math.round(angle)) < 0.05 ? angle.toFixed(0) : angle.toFixed(1)}°`

/**
 * What the measure tool draws: markers at the hovered, first and second
 * points, a dashed line between them, the angle from an edge the first point
 * snapped to, and a badge naming the snap under the pointer.
 *
 * It also marks state on the host element (`data-measurement-snap` and
 * friends) for the browser tests, and reports each distinct state once.
 */
export class MeasurementOverlay {
  state: MeasurementState = EMPTY
  private reportedKey = ''
  private readonly markerGeometry = new THREE.SphereGeometry(1, 20, 14)
  private readonly hoverMarker = new THREE.Mesh(this.markerGeometry, new THREE.MeshBasicMaterial({ color: '#f3d27d', depthTest: false }))
  private readonly vertexHalo = new THREE.Mesh(this.markerGeometry, new THREE.MeshBasicMaterial({ color: '#69ddb2', transparent: true, opacity: 0.82, wireframe: true, depthTest: false }))
  private readonly startMarker = new THREE.Mesh(this.markerGeometry, new THREE.MeshBasicMaterial({ color: '#69ddb2', depthTest: false }))
  private readonly endMarker = new THREE.Mesh(this.markerGeometry, new THREE.MeshBasicMaterial({ color: '#f3d27d', depthTest: false }))
  private readonly lineGeometry = new THREE.BufferGeometry()
  private readonly line = new THREE.Line(this.lineGeometry, new THREE.LineDashedMaterial({ color: '#f1cd74', dashSize: 3, gapSize: 1.5, depthTest: false }))
  private readonly angleGeometry = new THREE.BufferGeometry()
  private readonly angleArc = new THREE.Line(this.angleGeometry, new THREE.LineBasicMaterial({ color: '#f1a95f', depthTest: false, transparent: true, opacity: 0.95 }))
  private readonly badge = document.createElement('div')

  constructor(
    private readonly host: HTMLElement,
    group: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly picker: ViewportPicker,
    private readonly edgeHighlight: EdgeHighlight,
    private readonly onChange: (measurement: MeasurementState) => void,
  ) {
    this.badge.className = 'measurement-snap-badge'
    this.badge.hidden = true
    host.append(this.badge)
    for (const object of [this.hoverMarker, this.vertexHalo, this.startMarker, this.endMarker, this.line, this.angleArc]) object.visible = false
    group.add(this.line, this.angleArc, edgeHighlight.object, this.vertexHalo, this.hoverMarker, this.startMarker, this.endMarker)
  }

  reset() {
    this.update(EMPTY)
  }

  /** The hover marker alone, for tools other than measuring that point at something. */
  showHoverMarker(point: Vec3 | null) {
    this.hoverMarker.visible = point !== null
    if (point) this.hoverMarker.position.set(...point)
  }

  update(next: MeasurementState) {
    this.state = next
    const { hover, start, end } = next
    this.hoverMarker.visible = Boolean(hover)
    this.vertexHalo.visible = hover?.snapType === 'vertex'
    this.startMarker.visible = Boolean(start)
    this.endMarker.visible = Boolean(end)
    if (hover) {
      this.hoverMarker.position.set(...hover.point)
      this.vertexHalo.position.set(...hover.point)
      ;(this.hoverMarker.material as THREE.MeshBasicMaterial).color.set(hover.snapType === 'vertex' ? '#9affd8' : '#f3d27d')
    }
    const hoveredEdge = hover?.edgeSegments
    this.edgeHighlight.show(hoveredEdge ?? [], '#8ff0cc')
    if (start) this.startMarker.position.set(...start.point)
    if (end) this.endMarker.position.set(...end.point)

    const lineEnd = end ?? (start ? hover : null)
    this.line.visible = Boolean(start && lineEnd)
    if (start && lineEnd) {
      this.lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute([...start.point, ...lineEnd.point], 3))
      this.lineGeometry.computeBoundingSphere()
      this.line.computeLineDistances()
    }
    this.angleArc.visible = Boolean(start && lineEnd && this.drawAngleArc(start, lineEnd))

    this.host.dataset.measurementSnap = hover?.snapType ?? ''
    this.host.dataset.measurementVertexHighlight = hover?.snapType === 'vertex' ? 'active' : ''
    this.host.dataset.measurementEdgeHighlight = hoveredEdge?.length ? 'active' : ''
    this.updateBadge(hover, start)

    const key = `${referenceKey(hover)}|${referenceKey(start)}|${referenceKey(end)}`
    if (key === this.reportedKey) return
    this.reportedKey = key
    this.onChange(next)
  }

  /**
   * The angle between the line being measured and the edge its start snapped
   * to, as an arc a fixed size on screen. False when there is no such angle.
   */
  private drawAngleArc(start: MeasurementReference, lineEnd: MeasurementReference) {
    const edgeDirection = measurementEdgeDirection(start)
    const origin = new THREE.Vector3(...start.point)
    const direction = new THREE.Vector3(...lineEnd.point).sub(origin)
    if (!edgeDirection || direction.lengthSq() <= 1e-12) return false
    direction.normalize()
    let edge = new THREE.Vector3(...edgeDirection).normalize()
    if (edge.dot(direction) < 0) edge = edge.negate()
    const cosine = THREE.MathUtils.clamp(edge.dot(direction), -1, 1)
    const angle = Math.acos(cosine)
    const perpendicular = direction.clone().addScaledVector(edge, -cosine)
    if (angle <= 1e-4 || perpendicular.lengthSq() <= 1e-12) return false
    perpendicular.normalize()
    const bounds = this.host.getBoundingClientRect()
    const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
      * this.camera.position.distanceTo(origin) / Math.max(1, bounds.height)
    const radius = worldPerPixel * ANGLE_ARC_RADIUS_PX
    const points = [origin.clone()]
    const steps = Math.max(8, Math.ceil(angle / (Math.PI / 36)))
    for (let index = 0; index <= steps; index += 1) {
      const theta = angle * index / steps
      points.push(origin.clone().addScaledVector(edge, Math.cos(theta) * radius).addScaledVector(perpendicular, Math.sin(theta) * radius))
    }
    points.push(origin.clone())
    this.angleGeometry.setFromPoints(points)
    this.angleGeometry.computeBoundingSphere()
    return true
  }

  private updateBadge(hover: MeasurementReference | null, start: MeasurementReference | null) {
    this.badge.hidden = !hover
    if (!hover) return
    const screen = this.picker.clientPoint(new THREE.Vector3(...hover.point))
    const bounds = this.host.getBoundingClientRect()
    const relative = start ? measurementRelativeEdgeAngles(start, start.point, hover.point) : null
    const orientation = start ? measurementLineOrientation(start.point, hover.point) : null
    const relativeLabel = relative ? ` · REL ${compactAngle(relative.smaller)}` : ''
    const absoluteLabel = orientation?.kind === 'planar' ? ` · ABS ${compactAngle(orientation.bearing)}` : ''
    this.badge.textContent = `${hover.snapType.toUpperCase()} SNAP${relativeLabel}${absoluteLabel}`
    this.badge.style.left = `${screen.x - bounds.left + 13}px`
    this.badge.style.top = `${screen.y - bounds.top - 25}px`
  }

  dispose() {
    this.badge.remove()
    this.markerGeometry.dispose()
    for (const object of [this.hoverMarker, this.vertexHalo, this.startMarker, this.endMarker, this.line, this.angleArc]) {
      (object.material as THREE.Material).dispose()
    }
    this.lineGeometry.dispose()
    this.angleGeometry.dispose()
  }
}
