import { describe, expect, it } from 'vitest'
import { areTrianglesCoplanar, type Triangle3 } from './face-geometry'
import { COPLANAR_FACE_DISTANCE_MM } from './tolerance-policy'

describe('B-rep face planarity', () => {
  it('accepts a planar face regardless of camera orientation', () => {
    const face: Triangle3[] = [
      [[-5, 2, 0], [5, 2, 0], [5, 2, 8]],
      [[-5, 2, 0], [5, 2, 8], [-5, 2, 8]],
    ]
    expect(areTrianglesCoplanar(face)).toBe(true)
  })

  it('rejects tessellated strips from a curved wall', () => {
    const curvedWall: Triangle3[] = [
      [[5, 0, 0], [4.33, 2.5, 0], [4.33, 2.5, 8]],
      [[5, 0, 0], [4.33, 2.5, 8], [5, 0, 8]],
      [[4.33, 2.5, 0], [2.5, 4.33, 0], [2.5, 4.33, 8]],
      [[4.33, 2.5, 0], [2.5, 4.33, 8], [4.33, 2.5, 8]],
    ]
    expect(areTrianglesCoplanar(curvedWall)).toBe(false)
  })

  it('uses the policy distance as the default coplanarity boundary', () => {
    const face = (offset: number): Triangle3[] => [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 0, offset], [1, 1, offset], [0, 1, offset]],
    ]
    expect(areTrianglesCoplanar(face(COPLANAR_FACE_DISTANCE_MM - 0.001))).toBe(true)
    expect(areTrianglesCoplanar(face(COPLANAR_FACE_DISTANCE_MM + 0.001))).toBe(false)
  })
})
