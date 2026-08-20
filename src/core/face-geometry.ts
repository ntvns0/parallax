import type { Vec3 } from './model'
import { COPLANAR_FACE_DISTANCE_MM } from './tolerance-policy'

export type Triangle3 = [Vec3, Vec3, Vec3]

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

export function areTrianglesCoplanar(triangles: Triangle3[], tolerance = COPLANAR_FACE_DISTANCE_MM) {
  if (!triangles.length) return false
  let normal: Vec3 | null = null
  let origin: Vec3 | null = null
  for (const triangle of triangles) {
    const candidate = cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[0]))
    const length = Math.hypot(...candidate)
    if (length > 1e-9) {
      normal = [candidate[0] / length, candidate[1] / length, candidate[2] / length]
      origin = triangle[0]
      break
    }
  }
  if (!normal || !origin) return false
  const planeConstant = dot(normal, origin)
  return triangles.flat().every((point) => Math.abs(dot(normal!, point) - planeConstant) <= tolerance)
}
