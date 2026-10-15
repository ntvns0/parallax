import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { distanceAlongAxis } from './ray-axis'

const up = new THREE.Vector3(0, 0, 1)
const origin = new THREE.Vector3(0, 0, 0)

describe('distanceAlongAxis', () => {
  it('finds where a sideways ray crosses the axis', () => {
    // Looking along +X at height 5: the nearest point on the Z axis is z = 5.
    const ray = new THREE.Ray(new THREE.Vector3(-100, 0, 5), new THREE.Vector3(1, 0, 0))
    expect(distanceAlongAxis(ray, origin, up)).toBeCloseTo(5)
  })

  it('measures from the given origin', () => {
    const ray = new THREE.Ray(new THREE.Vector3(-100, 0, 5), new THREE.Vector3(1, 0, 0))
    expect(distanceAlongAxis(ray, new THREE.Vector3(0, 0, 8), up)).toBeCloseTo(-3)
  })

  it('works for a slanted ray that misses the axis', () => {
    const direction = new THREE.Vector3(1, 0, -1).normalize()
    const ray = new THREE.Ray(new THREE.Vector3(-10, 3, 20), direction)
    // The ray passes x = 0 at z = 10, 3 mm to the side of the axis.
    expect(distanceAlongAxis(ray, origin, up)).toBeCloseTo(10)
  })

  it('has no answer looking straight down the axis', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, -1))
    expect(distanceAlongAxis(ray, origin, up)).toBeNull()
  })
})
