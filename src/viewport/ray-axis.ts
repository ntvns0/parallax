import * as THREE from 'three'

/**
 * How far along a world axis the pointer's ray passes closest, measured from
 * `origin`.
 *
 * The pointer moves in two dimensions and a pulled face in one, so the cursor
 * ray is closed onto the drag axis: the answer is the point on the axis
 * nearest the ray. Where the ray is nearly parallel to the axis — looking
 * straight down a face's normal — that point races off to infinity, so the
 * answer is null and a caller holds still rather than leaping.
 */
export function distanceAlongAxis(ray: THREE.Ray, origin: THREE.Vector3, axis: THREE.Vector3): number | null {
  const cross = new THREE.Vector3().crossVectors(axis, ray.direction)
  const denominator = cross.lengthSq()
  if (denominator < 1e-6) return null
  const between = new THREE.Vector3().subVectors(ray.origin, origin)
  return new THREE.Vector3().crossVectors(between, ray.direction).dot(cross) / denominator
}
