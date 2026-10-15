import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { coplanarTriangles, describeFace, faceGroupSamples, faceSampleAt } from './face-geometry'

/**
 * A 50 × 30 × 8 plate with its top at z = 8, carrying face groups the way a
 * kernel mesh does. BoxGeometry's groups run +X, -X, +Y, -Y, +Z, -Z.
 */
function plate() {
  const geometry = new THREE.BoxGeometry(50, 30, 8)
  geometry.translate(0, 0, 4)
  geometry.userData.faceGroups = geometry.groups.map((group, faceId) => ({ start: group.start, count: group.count, faceId }))
  return geometry
}

const TOP = 4

describe('coplanarTriangles', () => {
  it('finds both triangles of the top face and nothing else', () => {
    const geometry = plate()
    const vertex = geometry.index!.getX(geometry.groups[TOP].start)
    const triangles = coplanarTriangles(geometry, new THREE.Vector3(0, 0, 1), vertex)
    expect(triangles).toHaveLength(2)
    for (const point of triangles.flat()) expect(point.z).toBeCloseTo(8)
  })
})

describe('describeFace', () => {
  it('describes the top face as a sketch on XY sees it', () => {
    const geometry = plate()
    const vertex = geometry.index!.getX(geometry.groups[TOP].start)
    const triangles = coplanarTriangles(geometry, new THREE.Vector3(0, 0, 1), vertex)
    const face = describeFace(triangles, new THREE.Matrix4(), [0, 0, 8], 'XY', { id: 'plate', name: 'Plate' }, 1)
    expect(face.faceLabel).toBe('Top face')
    expect(face.area).toBeCloseTo(1500)
    expect(face.bounds.min).toEqual([-25, -15])
    expect(face.bounds.max).toEqual([25, 15])
    expect(face.center).toEqual([0, 0])
    // Four sides; the diagonal both triangles share is not part of the outline.
    expect(face.edges).toHaveLength(4)
  })

  it('places the face where the mesh is, not where its geometry is', () => {
    const geometry = plate()
    const vertex = geometry.index!.getX(geometry.groups[TOP].start)
    const triangles = coplanarTriangles(geometry, new THREE.Vector3(0, 0, 1), vertex)
    const moved = new THREE.Matrix4().makeTranslation(100, 0, 0)
    const face = describeFace(triangles, moved, [100, 0, 8], 'XY', { id: 'plate', name: 'Plate' }, 1)
    expect(face.center).toEqual([100, 0])
  })
})

describe('face samples', () => {
  it('samples every face group, each flat', () => {
    const { samples, groups } = faceGroupSamples(plate())
    expect(samples).toHaveLength(6)
    expect(groups).toHaveLength(6)
    expect(samples.every((sample) => sample.planar)).toBe(true)
  })

  it('samples the face under a raycast, in world space', () => {
    const geometry = plate()
    const triangle = geometry.groups[TOP].start / 3
    const sample = faceSampleAt(geometry, new THREE.Matrix4().makeTranslation(0, 0, 10), triangle)!
    expect(sample.planar).toBe(true)
    for (const point of sample.points) expect(point[2]).toBeCloseTo(18)
  })

  it('has nothing to say about a mesh without kernel face groups', () => {
    expect(faceSampleAt(new THREE.BoxGeometry(), new THREE.Matrix4(), 0)).toBeNull()
    expect(faceGroupSamples(new THREE.BoxGeometry()).samples).toEqual([])
  })
})
