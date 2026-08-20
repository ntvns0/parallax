import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Safely sync OrbitControls internal orientation quaternion with camera.up.
 * OrbitControls caches its world-up basis during construction. Switching between
 * Z-up and Y-up (e.g. top view vs front/iso view) requires keeping OrbitControls'
 * internal basis quaternion synchronized to prevent camera flips or unexpected rotation axes.
 */
export function syncOrbitControlsUp(orbit: OrbitControls, camera: THREE.PerspectiveCamera, up: THREE.Vector3): void {
  camera.up.copy(up)
  const internalControls = orbit as unknown as { _quat?: THREE.Quaternion; _quatInverse?: THREE.Quaternion }
  if (internalControls._quat && internalControls._quatInverse) {
    internalControls._quat.setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0))
    internalControls._quatInverse.copy(internalControls._quat).invert()
  }
}
