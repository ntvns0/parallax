import * as THREE from 'three'
import type { FaceSample } from '../core/face-ownership'
import type { SketchFaceAttachment, SketchPlane, Vec2, Vec3 } from '../core/model'
import { projectToSketchPlane } from './face-classification'

/**
 * Reading faces back out of a triangulated mesh: which triangles make up the
 * face under the pointer, what that face looks like from a sketch plane, and
 * where the kernel's face groups sit in the world.
 */

export type Triangle = [THREE.Vector3, THREE.Vector3, THREE.Vector3]

/** How far off the face's plane a vertex may sit and still be on it, in millimetres. */
const PLANE_TOLERANCE = 0.02

/**
 * Every triangle of `geometry` lying in the plane of the triangle that has
 * `normal` and the vertex `vertexIndex`, in the geometry's own space.
 */
export function coplanarTriangles(geometry: THREE.BufferGeometry, normal: THREE.Vector3, vertexIndex: number): Triangle[] {
  const positions = geometry.getAttribute('position')
  if (!positions) return []
  return planeTriangles(geometry, normal, new THREE.Vector3().fromBufferAttribute(positions, vertexIndex))
}

/**
 * Every triangle of `geometry` facing along `normal` in the plane through
 * `point`, in the geometry's own space. Triangles facing the other way are
 * left out, so the far wall of a thin part is not taken for this face.
 */
export function planeTriangles(geometry: THREE.BufferGeometry, normal: THREE.Vector3, point: THREE.Vector3, facing: 'either' | 'same' = 'either'): Triangle[] {
  const positions = geometry.getAttribute('position')
  if (!positions) return []
  const targetNormal = normal.clone().normalize()
  const planeConstant = targetNormal.dot(point)
  const index = geometry.index
  const triangleCount = index ? index.count / 3 : positions.count / 3
  const triangles: Triangle[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const triangleNormal = new THREE.Vector3()
  const onPlane = (point: THREE.Vector3) => Math.abs(targetNormal.dot(point) - planeConstant) < PLANE_TOLERANCE
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    a.fromBufferAttribute(positions, index ? index.getX(triangle * 3) : triangle * 3)
    b.fromBufferAttribute(positions, index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1)
    c.fromBufferAttribute(positions, index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2)
    edgeA.subVectors(b, a)
    edgeB.subVectors(c, a)
    triangleNormal.crossVectors(edgeA, edgeB).normalize()
    const alignment = triangleNormal.dot(targetNormal)
    if ((facing === 'same' ? alignment : Math.abs(alignment)) > 0.9999 && onPlane(a) && onPlane(b) && onPlane(c)) {
      triangles.push([a.clone(), b.clone(), c.clone()])
    }
  }
  return triangles
}

/** The triangles of the face a raycast landed on, in the mesh's own space. */
export function hitFaceTriangles(hit: THREE.Intersection): Triangle[] {
  if (!hit.face || !(hit.object instanceof THREE.Mesh)) return []
  return coplanarTriangles(hit.object.geometry, hit.face.normal, hit.face.a)
}

const FACE_LABELS: Record<SketchPlane, [string, string]> = {
  XY: ['Bottom face', 'Top face'],
  XZ: ['Back face', 'Front face'],
  YZ: ['Left face', 'Right face'],
}

/**
 * A face as a sketch on it sees it: its outline, centre, bounds and area in
 * sketch coordinates. The outline is the triangle edges used only once, which
 * are the boundary; interior diagonals are shared by two triangles.
 */
export function describeFace(
  triangles: Triangle[],
  matrixWorld: THREE.Matrix4,
  fallback: Vec3,
  plane: SketchPlane,
  feature: { id: string; name: string },
  faceNormalSign: -1 | 1,
): SketchFaceAttachment {
  const edgeMap = new Map<string, { count: number; start: Vec2; end: Vec2 }>()
  const allPoints: Vec2[] = []
  let area = 0
  const quantized = (point: Vec2) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`
  for (const triangle of triangles) {
    const world = triangle.map((point) => point.clone().applyMatrix4(matrixWorld)) as Triangle
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
  const projectedFallback = projectToSketchPlane(plane, fallback)
  const min: Vec2 = allPoints.length
    ? [Math.min(...allPoints.map((point) => point[0])), Math.min(...allPoints.map((point) => point[1]))]
    : projectedFallback
  const max: Vec2 = allPoints.length
    ? [Math.max(...allPoints.map((point) => point[0])), Math.max(...allPoints.map((point) => point[1]))]
    : projectedFallback
  return {
    type: 'face',
    featureId: feature.id,
    featureName: feature.name,
    faceLabel: FACE_LABELS[plane][faceNormalSign > 0 ? 1 : 0],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
    bounds: { min, max },
    edges: [...edgeMap.values()].filter((edge) => edge.count === 1).map(({ start, end }) => ({ start, end })),
    area,
  }
}

/** Where in the index buffer the kernel's faces sit. Set by `kernelMeshToGeometry`. */
export type FaceGroup = { start: number; count: number }

function faceGroupsOf(geometry: THREE.BufferGeometry) {
  return geometry.userData.faceGroups as FaceGroup[] | undefined
}

/**
 * Up to about two dozen points spread over one face group, and whether its
 * normals agree, which is what face ownership needs to recognise it.
 * `matrix` moves the points into world space; without it they stay local.
 */
function sampleFaceGroup(geometry: THREE.BufferGeometry, group: FaceGroup, matrix?: THREE.Matrix4): FaceSample | null {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const index = geometry.index!
  const points: Vec3[] = []
  const seen: THREE.Vector3[] = []
  const step = Math.max(3, Math.floor(group.count / 24 / 3) * 3)
  for (let at = group.start; at + 2 < group.start + group.count; at += step) {
    const vertex = index.getX(at)
    const point = new THREE.Vector3().fromBufferAttribute(positions, vertex)
    if (matrix) point.applyMatrix4(matrix)
    points.push(point.toArray() as Vec3)
    if (normals) seen.push(new THREE.Vector3().fromBufferAttribute(normals, vertex))
  }
  if (!points.length) return null
  return { points, planar: seen.every((normal) => normal.dot(seen[0]) > 0.999) }
}

/** A sample of every face group, in the geometry's own space, with the groups that produced them. */
export function faceGroupSamples(geometry: THREE.BufferGeometry): { samples: FaceSample[]; groups: FaceGroup[] } {
  const faceGroups = faceGroupsOf(geometry)
  if (!faceGroups?.length || !geometry.getAttribute('position') || !geometry.index) return { samples: [], groups: [] }
  const samples: FaceSample[] = []
  const groups: FaceGroup[] = []
  for (const group of faceGroups) {
    const sample = sampleFaceGroup(geometry, group)
    if (!sample) continue
    samples.push(sample)
    groups.push({ start: group.start, count: group.count })
  }
  return { samples, groups }
}

/**
 * The face a raycast landed on, as an ownership sample in world space.
 *
 * `faceIndex` counts triangles; face groups are measured in index-buffer
 * offsets, three per triangle, which is where the multiply comes from.
 */
export function faceSampleAt(geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4, faceIndex: number): FaceSample | null {
  const groups = faceGroupsOf(geometry)
  if (!groups?.length || !geometry.getAttribute('position') || !geometry.index) return null
  const offset = faceIndex * 3
  const group = groups.find((candidate) => offset >= candidate.start && offset < candidate.start + candidate.count)
  return group ? sampleFaceGroup(geometry, group, matrixWorld) : null
}
