import type { Vec3 } from '../core/model'
import type { CameraView } from './viewport-controller'

/**
 * The camera's two-way channel to the rest of the interface.
 *
 * The view cube and keyboard shortcuts send commands; the viewport carries
 * them out and reports where the camera now points, which the view cube
 * mirrors. Typed, so a misspelt view or a missing field is a compile error
 * rather than a click that silently does nothing, as untyped window events
 * allowed.
 */

export type CameraCommand =
  | { kind: 'view'; view: CameraView }
  | { kind: 'direction'; direction: Vec3; up?: Vec3 }
  | { kind: 'roll'; degrees: number }
  | { kind: 'reverse' }

/** The camera's orientation as a quaternion, x y z w. */
export type CameraOrientation = [number, number, number, number]

function channel<T>() {
  const listeners = new Set<(value: T) => void>()
  return {
    send(value: T) {
      for (const listener of listeners) listener(value)
    },
    listen(listener: (value: T) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const commands = channel<CameraCommand>()
const orientation = channel<CameraOrientation>()

export const sendCameraCommand = commands.send
/** Subscribe to camera commands. Returns the unsubscribe. */
export const onCameraCommand = commands.listen
export const publishCameraOrientation = orientation.send
/** Subscribe to camera orientation changes. Returns the unsubscribe. */
export const onCameraOrientation = orientation.listen
