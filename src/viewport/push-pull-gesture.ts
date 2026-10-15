import * as THREE from 'three'
import { useDocumentStore } from '../core/document-store'
import { clampPulledDistance, distanceAfterPull, pushPullTargetForFace, type PushPullTarget } from '../core/push-pull'
import { sketchSnapIncrement } from '../core/units'
import { faceSampleAt } from './face-geometry'
import { distanceAlongAxis } from './ray-axis'
import type { ViewportPicker } from './viewport-picker'

/** How far the pointer must travel before a press on a face counts as a drag, in pixels. */
const DRAG_THRESHOLD_PX = 3

type Drag = {
  target: PushPullTarget
  pressedAt: THREE.Vector2
  origin: THREE.Vector3
  axis: THREE.Vector3
  startOffset: number
  /**
   * False until the first parameter update of the gesture, which is the one
   * that records an undo step; every update after it amends.
   */
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
}

/**
 * Dragging a face along its normal to change the feature that made it.
 *
 * Marks `data-push-pull` on the host: `available` while hovering a face that
 * can be pulled, `dragging` during a pull.
 */
export class PushPullGesture {
  private drag: Drag | null = null

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLElement,
    private readonly orbit: { enabled: boolean },
    private readonly picker: ViewportPicker,
    private readonly meshes: () => Iterable<THREE.Mesh>,
  ) {}

  get active() {
    return this.drag !== null
  }

  /** What dragging the face under the pointer would edit, if anything. */
  targetAt(event: PointerEvent): { target: PushPullTarget; hit: THREE.Intersection } | null {
    const hit = this.picker.intersect(event, this.meshes())[0]
    if (!hit?.face || hit.faceIndex == null || !(hit.object instanceof THREE.Mesh)) return null
    hit.object.updateWorldMatrix(true, false)
    const sample = faceSampleAt(hit.object.geometry, hit.object.matrixWorld, hit.faceIndex)
    if (!sample) return null
    const target = pushPullTargetForFace(sample, useDocumentStore.getState().document.features)
    return target ? { target, hit } : null
  }

  /**
   * Arm a pull on the face under the pointer. Nothing changes until the
   * pointer moves. A face seen exactly edge-on along its normal cannot be
   * pulled, because the pointer has no way to say how far.
   */
  begin(event: PointerEvent) {
    const picked = this.targetAt(event)
    if (!picked) return
    const axis = new THREE.Vector3(...picked.target.axis).normalize()
    const origin = picked.hit.point.clone()
    const start = distanceAlongAxis(this.picker.ray(event), origin, axis)
    if (start === null) return
    this.drag = {
      target: picked.target,
      pressedAt: new THREE.Vector2(event.clientX, event.clientY),
      origin,
      axis,
      startOffset: start,
      committed: false,
      moved: false,
    }
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
  move(event: PointerEvent) {
    const drag = this.drag
    if (!drag) return
    if (!drag.moved) {
      if (drag.pressedAt.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) <= DRAG_THRESHOLD_PX) return
      drag.moved = true
      this.orbit.enabled = false
      this.host.dataset.pushPull = 'dragging'
      // Capture keeps the gesture alive past the edge of the canvas, but a
      // browser may refuse an id it no longer considers active. The drag still
      // ends on pointerup or pointercancel either way.
      try {
        this.canvas.setPointerCapture(event.pointerId)
      } catch {
        // Not fatal; the drag simply ends if the pointer leaves the canvas.
      }
    }
    const now = distanceAlongAxis(this.picker.ray(event), drag.origin, drag.axis)
    if (now === null) return

    const travelled = now - drag.startOffset
    const snap = sketchSnapIncrement(useDocumentStore.getState().document.displayUnits ?? 'mm')
    const snapped = event.shiftKey ? travelled : Math.round(travelled / snap) * snap
    const distance = clampPulledDistance(distanceAfterPull(drag.target, snapped), drag.target.distance)
    useDocumentStore.getState().updateParameters(drag.target.featureId, { distance }, { amend: drag.committed })
    drag.committed = true
  }

  /** Finish the gesture. True when it was a real drag, not a click. */
  end(event?: PointerEvent): boolean {
    const drag = this.drag
    if (!drag) return false
    if (event && this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    this.drag = null
    this.orbit.enabled = true
    delete this.host.dataset.pushPull
    return drag.moved
  }
}
