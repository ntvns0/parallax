import * as THREE from 'three'
import { disposeObject } from './exact-scene-adapter'
import { hitFaceTriangles, planeTriangles, type Triangle } from './face-geometry'
import type { FaceReference } from '../core/model'

/**
 * A tint over the face under the pointer: green where the current tool can use
 * it, red where it cannot. Marks `data-face-highlight` on the host for the
 * browser tests.
 */
export class FaceHighlight {
  private group: THREE.Group | null = null
  private key = ''

  constructor(private readonly host: HTMLElement) {}

  show(hit: THREE.Intersection, supported: boolean) {
    if (!hit.face || !(hit.object instanceof THREE.Mesh)) {
      this.clear()
      return
    }
    const mesh = hit.object
    const positions = mesh.geometry.getAttribute('position')
    if (!positions) return
    // One key per face and verdict, so moving across a face does not rebuild it.
    const normal = hit.face.normal.clone().normalize()
    const planeConstant = normal.dot(new THREE.Vector3().fromBufferAttribute(positions, hit.face.a))
    const key = `${mesh.userData.featureId}:${normal.toArray().map((value) => value.toFixed(3)).join(',')}:${planeConstant.toFixed(3)}:${supported}`
    if (key === this.key) return
    this.clear()

    const trianglePositions = hitFaceTriangles(hit).flatMap((triangle) => triangle.flatMap((point) => point.toArray()))
    if (!trianglePositions.length) return
    const color = supported ? '#69ddb2' : '#e08787'
    this.group = tint(trianglePositions, color, supported ? 0.34 : 0.22)
    mesh.add(this.group)
    this.key = key
    this.host.dataset.faceHighlight = supported ? 'supported' : 'unsupported'
  }

  clear() {
    if (this.group) {
      this.group.removeFromParent()
      disposeObject(this.group)
      this.group = null
    }
    this.key = ''
    delete this.host.dataset.faceHighlight
  }
}

/** A see-through fill and outline over some triangles, drawn over the part. */
function tint(trianglePositions: number[], color: string, opacity: number) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(trianglePositions, 3))
  geometry.computeVertexNormals()
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
  }))
  fill.raycast = () => undefined
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }))
  edges.raycast = () => undefined
  const group = new THREE.Group()
  group.renderOrder = 20
  group.add(fill, edges)
  return group
}

/**
 * The faces picked so far, tinted on the part. A picked face is found again
 * from its reference: the triangles in its plane facing its way. Only flat
 * faces are tinted; a curved one is counted in the banner but not drawn.
 * Marks `data-picked-faces` on the host with how many are drawn.
 */
export class FaceSelection {
  private group: THREE.Group | null = null

  constructor(private readonly host: HTMLElement) {}

  show(mesh: THREE.Mesh | undefined, faces: Pick<FaceReference, 'point' | 'normal'>[]) {
    this.clear()
    if (!mesh || !faces.length) return
    mesh.updateWorldMatrix(true, false)
    const toLocal = mesh.matrixWorld.clone().invert()
    const normalToLocal = new THREE.Matrix3().getNormalMatrix(toLocal)
    const triangles: Triangle[] = []
    let drawn = 0
    for (const face of faces) {
      const point = new THREE.Vector3(...face.point).applyMatrix4(toLocal)
      const normal = new THREE.Vector3(...face.normal).applyMatrix3(normalToLocal).normalize()
      const found = planeTriangles(mesh.geometry, normal, point, 'same')
      if (found.length) drawn += 1
      triangles.push(...found)
    }
    this.host.dataset.pickedFaces = String(drawn)
    if (!triangles.length) return
    this.group = tint(triangles.flatMap((triangle) => triangle.flatMap((vertex) => vertex.toArray())), '#ff8a4d', 0.4)
    mesh.add(this.group)
  }

  clear() {
    if (this.group) {
      this.group.removeFromParent()
      disposeObject(this.group)
      this.group = null
    }
    delete this.host.dataset.pickedFaces
  }
}
