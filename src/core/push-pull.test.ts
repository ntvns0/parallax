import { describe, expect, it } from 'vitest'
import {
  createExtrudeFeature,
  createFeature,
  createId,
  type ExtrudeFeature,
  type Feature,
  type SketchEntity,
  type SketchFeature,
  type Vec2,
  type Vec3,
} from './model'
import type { FaceSample } from './face-ownership'
import { clampPulledDistance, distanceAfterPull, planeNormalAxis, pushPullTargetForFace } from './push-pull'

/**
 * Push/pull resolves a face to the number that made it.
 *
 * These are the cases where getting the sign or the rate wrong produces a
 * feature that fights the pointer — moving the wrong way, or at half or double
 * speed — which is the difference between direct modeling that feels immediate
 * and one that feels broken.
 */

function line(start: Vec2, end: Vec2): SketchEntity {
  return { id: createId(), type: 'line', start, end, construction: false }
}

function rectangleSketch(min: Vec2, max: Vec2, index = 1): SketchFeature {
  const sketch = createFeature('sketch', index) as SketchFeature
  sketch.entities = [
    line([min[0], min[1]], [max[0], min[1]]),
    line([max[0], min[1]], [max[0], max[1]]),
    line([max[0], max[1]], [min[0], max[1]]),
    line([min[0], max[1]], [min[0], min[1]]),
  ]
  return sketch
}

/** A flat face sampled at a set of world points. */
function planarFace(points: Vec3[]): FaceSample {
  return { points, planar: true }
}

/** The four corners of a 20 x 20 cap at height z. */
function capAt(z: number): FaceSample {
  return planarFace([[-10, -10, z], [10, -10, z], [10, 10, z], [-10, 10, z]])
}

function plate(distance = 10, symmetric = false): { features: Feature[]; extrude: ExtrudeFeature } {
  const sketch = rectangleSketch([-10, -10], [10, 10])
  const extrude = createExtrudeFeature(sketch.id, 1, distance)
  extrude.parameters.symmetric = symmetric
  return { features: [sketch, extrude], extrude }
}

describe('planeNormalAxis', () => {
  it('points the way each plane offset grows, including the XZ flip', () => {
    expect(planeNormalAxis('XY')).toEqual([0, 0, 1])
    expect(planeNormalAxis('YZ')).toEqual([1, 0, 0])
    // The one asymmetry in the Z-up convention: XZ offsets grow along -Y.
    expect(planeNormalAxis('XZ')).toEqual([0, -1, 0])
  })
})

describe('pushPullTargetForFace', () => {
  it('resolves the far cap of an extrusion to its distance', () => {
    const { features, extrude } = plate(10)
    const target = pushPullTargetForFace(capAt(10), features)

    expect(target?.featureId).toBe(extrude.id)
    expect(target?.depth).toBe(1)
    expect(target?.distance).toBe(10)
    expect(target?.distancePerMillimetre).toBe(1)
  })

  it('resolves a cap sampled only at its corners', () => {
    // The case that decided how this resolves owners. A planar cap tessellates
    // entirely from vertices on its own boundary, and ray-casting containment is
    // undefined exactly on a boundary — `attributeFaces` returns null for this
    // face. Push/pull acts on caps and nothing else, so it cannot depend on that.
    const { features, extrude } = plate(10)
    const corners = planarFace([[-10, -10, 10], [10, -10, 10], [10, 10, 10], [-10, 10, 10]])

    expect(pushPullTargetForFace(corners, features)?.featureId).toBe(extrude.id)
  })

  it('picks the newest extrusion when two end at the same depth', () => {
    const first = rectangleSketch([-10, -10], [10, 10], 1)
    const firstExtrude = createExtrudeFeature(first.id, 1, 10)
    const second = rectangleSketch([-10, -10], [10, 10], 2)
    const secondExtrude = createExtrudeFeature(second.id, 2, 10)

    const target = pushPullTargetForFace(capAt(10), [first, firstExtrude, second, secondExtrude])
    expect(target?.featureId).toBe(secondExtrude.id)
  })

  it('ignores a hidden extrusion', () => {
    const { features, extrude } = plate(10)
    extrude.visible = false
    expect(pushPullTargetForFace(capAt(10), features)).toBeNull()
  })

  it('refuses the sketch-plane end of an asymmetric extrusion', () => {
    // That face is the sketch. Dragging it would move the sketch rather than
    // change a depth, which is a different edit with a different undo story.
    expect(pushPullTargetForFace(capAt(0), plate(10).features)).toBeNull()
  })

  it('refuses a side wall', () => {
    // A wall follows the profile, so it belongs to the sketch, not the distance.
    const wall = planarFace([[10, -10, 0], [10, 10, 0], [10, 10, 10], [10, -10, 10]])
    expect(pushPullTargetForFace(wall, plate(10).features)).toBeNull()
  })

  it('refuses a curved face', () => {
    const curved: FaceSample = { points: [[0, 0, 10], [1, 0, 10]], planar: false }
    expect(pushPullTargetForFace(curved, plate(10).features)).toBeNull()
  })

  it('refuses a face no feature explains', () => {
    expect(pushPullTargetForFace(capAt(999), plate(10).features)).toBeNull()
  })

  it('drags both ends of a symmetric extrusion, at double rate', () => {
    // A symmetric sweep straddles its plane, so each cap carries half the depth
    // and moving one cap 1 mm lengthens the feature by 2 mm.
    const { features } = plate(10, true)

    const far = pushPullTargetForFace(capAt(5), features)
    expect(far?.depth).toBe(1)
    expect(far?.distancePerMillimetre).toBe(2)

    const near = pushPullTargetForFace(capAt(-5), features)
    expect(near?.depth).toBe(0)
    // The near cap travels against the depth, so it pulls the other way.
    expect(near?.distancePerMillimetre).toBe(-2)
  })

  it('follows the outward normal of a face-attached sketch', () => {
    // A sketch on a downward-facing face stores its distance along that face's
    // normal, so a drag along +Z has to come back as a negative distance.
    const base = rectangleSketch([-10, -10], [10, 10], 1)
    const baseExtrude = createExtrudeFeature(base.id, 1, 10)

    const onTop = rectangleSketch([-5, -5], [5, 5], 2)
    onTop.parameters.planeOffset = 10
    onTop.parameters.faceNormalSign = -1
    const boss = createExtrudeFeature(onTop.id, 2, 4)
    boss.operation = 'add'

    const features: Feature[] = [base, baseExtrude, onTop, boss]
    // faceNormalSign -1 sweeps downward from the plane: 10 → 6.
    const target = pushPullTargetForFace(planarFace([[-5, -5, 6], [5, -5, 6], [5, 5, 6], [-5, 5, 6]]), features)

    expect(target?.featureId).toBe(boss.id)
    expect(target?.distancePerMillimetre).toBe(-1)
  })
})

describe('distanceAfterPull', () => {
  it('turns face movement into a distance', () => {
    const { features } = plate(10)
    const target = pushPullTargetForFace(capAt(10), features)!

    expect(distanceAfterPull(target, 4)).toBe(14)
    expect(distanceAfterPull(target, -4)).toBe(6)
  })
})

describe('clampPulledDistance', () => {
  it('leaves a buildable distance alone', () => {
    expect(clampPulledDistance(7.5, 10)).toBe(7.5)
    expect(clampPulledDistance(-7.5, -10)).toBe(-7.5)
  })

  it('lets a drag cross from add to cut', () => {
    // On a face-attached sketch the sign is the operation, so pushing a boss
    // back through its face and onward has to be allowed to make a pocket.
    expect(clampPulledDistance(-3, 10)).toBe(-3)
  })

  it('steps over the one depth that cannot be built', () => {
    expect(Math.abs(clampPulledDistance(0, 10))).toBeGreaterThan(0)
    expect(clampPulledDistance(0, 10)).toBeGreaterThan(0)
    expect(clampPulledDistance(0, -10)).toBeLessThan(0)
    // A tiny negative reading stays negative rather than snapping back across.
    expect(clampPulledDistance(-0.0001, 10)).toBeLessThan(0)
  })
})
