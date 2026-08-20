import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../core/model'
import { classifyFaceNormal, projectToSketchPlane, sketchPlaneOffset } from './face-classification'

describe('face classification', () => {
  it('maps each axis-aligned normal to its principal plane', () => {
    expect(classifyFaceNormal([0, 0, 1])).toEqual({ plane: 'XY', faceNormalSign: 1 })
    expect(classifyFaceNormal([0, 0, -1])).toEqual({ plane: 'XY', faceNormalSign: -1 })
    expect(classifyFaceNormal([1, 0, 0])).toEqual({ plane: 'YZ', faceNormalSign: 1 })
    expect(classifyFaceNormal([-1, 0, 0])).toEqual({ plane: 'YZ', faceNormalSign: -1 })
  })

  it('treats -Y as the front of an XZ sketch', () => {
    // XZ sketches extrude along -Y, so the front face is the positive direction.
    expect(classifyFaceNormal([0, -1, 0])).toEqual({ plane: 'XZ', faceNormalSign: 1 })
    expect(classifyFaceNormal([0, 1, 0])).toEqual({ plane: 'XZ', faceNormalSign: -1 })
  })

  it('refuses faces that are not square to an axis', () => {
    const tilted: Vec3 = [0, Math.sin(0.2), Math.cos(0.2)]
    expect(classifyFaceNormal(tilted)).toBeNull()
    expect(classifyFaceNormal([0.577, 0.577, 0.577])).toBeNull()
  })

  it('accepts tessellation noise just inside the tolerance', () => {
    const almostFlat: Vec3 = [0.0001, 0.0001, 0.99999999]
    expect(classifyFaceNormal(almostFlat)).toEqual({ plane: 'XY', faceNormalSign: 1 })
  })

  it('measures plane offset along the plane normal', () => {
    expect(sketchPlaneOffset('XY', [3, 7, 12])).toBe(12)
    expect(sketchPlaneOffset('XZ', [3, 7, 12])).toBe(-7)
    expect(sketchPlaneOffset('YZ', [3, 7, 12])).toBe(3)
  })

  it('projects world points into sketch coordinates', () => {
    expect(projectToSketchPlane('XY', [3, 7, 12])).toEqual([3, 7])
    expect(projectToSketchPlane('XZ', [3, 7, 12])).toEqual([3, 12])
    expect(projectToSketchPlane('YZ', [3, 7, 12])).toEqual([7, 12])
  })

  it('keeps offset and projection consistent for a point on the plane', () => {
    // A point reconstructed from its projection and offset lands back where it
    // started, which is the invariant sketch-on-face placement depends on.
    const point: Vec3 = [3, 7, 12]
    const projected = projectToSketchPlane('XZ', point)
    const offset = sketchPlaneOffset('XZ', point)
    expect([projected[0], -offset, projected[1]]).toEqual(point)
  })
})
