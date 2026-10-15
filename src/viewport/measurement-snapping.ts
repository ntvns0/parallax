import * as THREE from 'three'
import { useDocumentStore } from '../core/document-store'
import {
  compareMeasurementSnapCandidates,
  MEASUREMENT_SNAP_RADIUS_PX,
  type MeasurementReference,
  type MeasurementSnapType,
} from '../core/measurement'
import type { Vec3 } from '../core/model'
import { edgeSnapReferences, worldEdgeSegments, type EdgeSegment } from './edge-references'
import { hitFaceTriangles } from './face-geometry'
import { edgeSourceOf } from './model-edges'
import type { ViewportPicker } from './viewport-picker'

type Candidate = { point: THREE.Vector3; snapType: MeasurementSnapType; distance: number; edgeSegments?: EdgeSegment[] }

const findFeature = (featureId: string | undefined) =>
  useDocumentStore.getState().document.features.find((candidate) => candidate.id === featureId)

/**
 * What the measure tool would measure from, under the pointer.
 *
 * First anything discrete on any solid's edges within reach — a vertex, an
 * edge midpoint, a hole centre — then, failing that, the best target on the
 * solid under the pointer: those again, a face or feature centre, the nearest
 * point on an edge, or the surface itself.
 *
 * Edge positions are read from each solid's edge source, not from the object
 * that draws them: how edges are rendered must not decide what can be snapped
 * to. See `model-edges.ts`.
 */
export class MeasurementSnapper {
  /** Discrete targets per feature, keyed on the edge data so they invalidate when the edges change. */
  private readonly cache = new Map<string, { edgeSourceId: string; references: MeasurementReference[] }>()

  constructor(private readonly picker: ViewportPicker) {}

  clearCache() {
    this.cache.clear()
  }

  referenceAt(event: PointerEvent, meshes: Map<string, THREE.Mesh>): MeasurementReference | null {
    const discrete = this.nearestDiscreteReference(event, meshes)
    if (discrete) return discrete
    const hit = this.picker.intersect(event, meshes.values())[0]
    return hit ? this.referenceOnHit(event, hit) : null
  }

  private nearestDiscreteReference(event: PointerEvent, meshes: Map<string, THREE.Mesh>): MeasurementReference | null {
    const cursor = new THREE.Vector2(event.clientX, event.clientY)
    let closest: { reference: MeasurementReference; distance: number } | null = null
    for (const [featureId, mesh] of meshes) {
      const feature = findFeature(featureId)
      const edgeSource = edgeSourceOf(mesh)
      if (!feature || !edgeSource) continue
      let cached = this.cache.get(featureId)
      if (!cached || cached.edgeSourceId !== edgeSource.id) {
        mesh.updateWorldMatrix(true, false)
        const segments = worldEdgeSegments(edgeSource.positions, mesh.matrixWorld)
        cached = { edgeSourceId: edgeSource.id, references: edgeSnapReferences(segments, edgeSource.edgeGroups, feature) }
        this.cache.set(featureId, cached)
      }
      for (const reference of cached.references) {
        const distance = this.picker.clientPoint(new THREE.Vector3(...reference.point)).distanceTo(cursor)
        // A vertex wins a near tie: it is the more deliberate target.
        const winsTie = closest && Math.abs(distance - closest.distance) < 0.5 && reference.snapType === 'vertex' && closest.reference.snapType !== 'vertex'
        if (distance <= MEASUREMENT_SNAP_RADIUS_PX && (!closest || distance < closest.distance || winsTie)) closest = { reference, distance }
      }
    }
    return closest?.reference ?? null
  }

  private referenceOnHit(event: PointerEvent, hit: THREE.Intersection): MeasurementReference | null {
    if (!(hit.object instanceof THREE.Mesh)) return null
    const mesh = hit.object
    const feature = findFeature(mesh.userData.featureId as string | undefined)
    if (!feature) return null
    const cursor = new THREE.Vector2(event.clientX, event.clientY)
    const candidates: Candidate[] = []
    const consider = (point: THREE.Vector3, snapType: MeasurementSnapType, distance = this.picker.clientPoint(point).distanceTo(cursor), edgeSegments?: EdgeSegment[]) => {
      if (distance <= MEASUREMENT_SNAP_RADIUS_PX) candidates.push({ point, snapType, distance, edgeSegments })
    }

    const faceTriangles = hitFaceTriangles(hit)
    if (faceTriangles.length >= 2) {
      const faceBounds = new THREE.Box3()
      faceTriangles.flat().forEach((point) => faceBounds.expandByPoint(point.clone().applyMatrix4(mesh.matrixWorld)))
      consider(faceBounds.getCenter(new THREE.Vector3()), 'face center')
    }
    mesh.geometry.computeBoundingBox()
    if (mesh.geometry.boundingBox) {
      consider(mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld), 'feature center')
    }

    const edgeSource = edgeSourceOf(mesh)
    if (edgeSource) this.considerEdges(mesh, edgeSource, cursor, consider)

    // Discrete design-intent targets win once acquired. Sorting only by
    // cursor distance made the continuously moving edge projection beat a
    // nearby corner or midpoint unless the pointer was pixel-perfect.
    candidates.sort(compareMeasurementSnapCandidates)
    const chosen: Candidate = candidates[0] ?? { point: hit.point, snapType: 'surface', distance: 0 }
    return {
      point: chosen.point.toArray() as Vec3,
      featureId: feature.id,
      featureName: feature.name,
      featureKind: feature.kind,
      snapType: chosen.snapType,
      ...(chosen.edgeSegments?.length ? { edgeSegments: chosen.edgeSegments } : {}),
    }
  }

  /** Vertices, edge midpoints, and the nearest point on each edge of one solid. */
  private considerEdges(
    mesh: THREE.Mesh,
    edgeSource: NonNullable<ReturnType<typeof edgeSourceOf>>,
    cursor: THREE.Vector2,
    consider: (point: THREE.Vector3, snapType: MeasurementSnapType, distance?: number, edgeSegments?: EdgeSegment[]) => void,
  ) {
    mesh.updateWorldMatrix(true, false)
    const positions = edgeSource.positions
    const edgeGroups = edgeSource.edgeGroups
    const worldVertex = (index: number) => new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld)
    const pointKey = (point: THREE.Vector3) => point.toArray().map((value) => value.toFixed(4)).join(',')
    const segments: { start: THREE.Vector3; end: THREE.Vector3; startKey: string; endKey: string; startIndex: number }[] = []
    const endpointCounts = new Map<string, number>()
    for (let index = 0; index + 1 < positions.count; index += 2) {
      const start = worldVertex(index)
      const end = worldVertex(index + 1)
      const startKey = pointKey(start)
      const endKey = pointKey(end)
      endpointCounts.set(startKey, (endpointCounts.get(startKey) ?? 0) + 1)
      endpointCounts.set(endKey, (endpointCounts.get(endKey) ?? 0) + 1)
      segments.push({ start, end, startKey, endKey, startIndex: index })
    }
    // The whole edge a segment belongs to, which is what lights up on hover.
    const groupSegments = new Map<number, EdgeSegment[]>()
    const edgeOf = (segment: typeof segments[number]): EdgeSegment[] => {
      const group = edgeGroups?.find((candidate) => segment.startIndex >= candidate.start && segment.startIndex < candidate.start + candidate.count)
      if (!group) return [{ start: segment.start.toArray() as Vec3, end: segment.end.toArray() as Vec3 }]
      let edge = groupSegments.get(group.start)
      if (!edge) {
        edge = []
        for (let index = group.start; index + 1 < group.start + group.count; index += 2) {
          edge.push({ start: worldVertex(index).toArray() as Vec3, end: worldVertex(index + 1).toArray() as Vec3 })
        }
        groupSegments.set(group.start, edge)
      }
      return edge
    }
    for (const group of edgeGroups ?? []) {
      if (group.count < 2 || group.start < 0 || group.start + group.count > positions.count) continue
      const start = worldVertex(group.start)
      const end = worldVertex(group.start + group.count - 1)
      if (start.distanceTo(end) < 0.001) continue
      consider(start, 'vertex')
      consider(end, 'vertex')
    }
    for (const segment of segments) {
      // Without edge groups, a vertex is wherever other than two segments meet.
      if (!edgeGroups?.length && endpointCounts.get(segment.startKey) !== 2) consider(segment.start, 'vertex')
      if (!edgeGroups?.length && endpointCounts.get(segment.endKey) !== 2) consider(segment.end, 'vertex')
      const edge = edgeOf(segment)
      consider(segment.start.clone().lerp(segment.end, 0.5), 'edge midpoint', undefined, edge)
      const screenStart = this.picker.clientPoint(segment.start)
      const screenEnd = this.picker.clientPoint(segment.end)
      const screenDelta = screenEnd.clone().sub(screenStart)
      const lengthSquared = screenDelta.lengthSq()
      const position = lengthSquared < 1e-9 ? 0 : THREE.MathUtils.clamp(cursor.clone().sub(screenStart).dot(screenDelta) / lengthSquared, 0, 1)
      const screenClosest = screenStart.clone().lerp(screenEnd, position)
      consider(segment.start.clone().lerp(segment.end, position), 'edge', screenClosest.distanceTo(cursor), edge)
    }
  }
}
