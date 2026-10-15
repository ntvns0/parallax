import * as THREE from 'three'
import type { Vec3 } from '../core/model'

type ClientPosition = { clientX: number; clientY: number }

/** Between the pointer on screen and rays into the scene, for one canvas and camera. */
export class ViewportPicker {
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()

  constructor(private readonly element: HTMLElement, private readonly camera: THREE.Camera) {}

  /** The ray from the camera through the pointer. Reused between calls; copy it to keep it. */
  ray(event: ClientPosition): THREE.Ray {
    const bounds = this.element.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.ray
  }

  /** What the pointer's ray hits among `objects`, nearest first, without descending into children. */
  intersect(event: ClientPosition, objects: Iterable<THREE.Object3D>): THREE.Intersection[] {
    this.ray(event)
    return this.raycaster.intersectObjects([...objects], false)
  }

  /** Where a world point appears, in client pixels. */
  clientPoint(point: THREE.Vector3): THREE.Vector2 {
    const bounds = this.element.getBoundingClientRect()
    const projected = point.clone().project(this.camera)
    return new THREE.Vector2(
      bounds.left + (projected.x + 1) * bounds.width / 2,
      bounds.top + (1 - projected.y) * bounds.height / 2,
    )
  }

  /** `clientPoint` for plain coordinates. */
  project = (point: Vec3): [number, number] => {
    const screen = this.clientPoint(new THREE.Vector3(...point))
    return [screen.x, screen.y]
  }
}
