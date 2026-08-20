import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { syncOrbitControlsUp } from './orbit-controls-adapter'

describe('syncOrbitControlsUp', () => {
  it('updates camera.up and syncs internal quaternions', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.up.set(0, 0, 1)
    const domElement = document.createElement('div')
    const orbit = new OrbitControls(camera, domElement)

    const newUp = new THREE.Vector3(0, 1, 0)
    syncOrbitControlsUp(orbit, camera, newUp)

    expect(camera.up.toArray()).toEqual([0, 1, 0])

    const internalControls = orbit as unknown as { _quat?: THREE.Quaternion; _quatInverse?: THREE.Quaternion }
    expect(internalControls._quat).toBeDefined()
    expect(internalControls._quatInverse).toBeDefined()
    orbit.dispose()
  })
})
