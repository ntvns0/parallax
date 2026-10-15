import * as THREE from 'three'
import { disposeObject } from './exact-scene-adapter'
import { hitFaceTriangles } from './face-geometry'

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
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(trianglePositions, 3))
    geometry.computeVertexNormals()
    const color = supported ? '#69ddb2' : '#e08787'
    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: supported ? 0.34 : 0.22, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    }))
    fill.raycast = () => undefined
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }))
    edges.raycast = () => undefined
    this.group = new THREE.Group()
    this.group.renderOrder = 20
    this.group.add(fill, edges)
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
