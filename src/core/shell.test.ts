import { describe, expect, it } from 'vitest'
import type { ExtrudeFeature, Feature, SketchFeature } from './model'
import { currentFaceReference, faceReference, sameFace, shellProblem } from './shell'

function box(height: number): Feature[] {
  const sketch: SketchFeature = {
    id: 'sketch', kind: 'sketch', name: 'Sketch 1', plane: 'XY', parameters: { planeOffset: 0 },
    position: [0, 0, 0], rotation: [0, 0, 0], visible: true, constraints: [],
    entities: [{ id: 'c', type: 'circle', center: [0, 0], radius: 10, construction: false }],
  }
  const extrude: ExtrudeFeature = {
    id: 'box', kind: 'extrude', name: 'Extrude 1', sketchId: 'sketch', operation: 'newBody',
    parameters: { distance: height, symmetric: false, edgeRadius: 0 }, position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
  }
  return [sketch, extrude]
}

describe('shell face references', () => {
  it('anchors a picked top face to the extrusion end it lies on', () => {
    const reference = faceReference([2, 3, 30], [0, 0, 2], box(30))
    expect(reference.normal).toEqual([0, 0, 1])
    expect(reference.anchor).toEqual({ kind: 'extrudeCap', featureId: 'box', depth: 1 })
  })

  it('moves the picked point with the face when the extrusion changes', () => {
    const reference = faceReference([2, 3, 30], [0, 0, 1], box(30))
    expect(currentFaceReference(reference, box(45)).point).toEqual([2, 3, 45])
  })

  it('leaves a face it cannot name where it was picked', () => {
    const side = faceReference([10, 0, 15], [1, 0, 0], box(30))
    expect(side.anchor).toBeUndefined()
    expect(currentFaceReference(side, box(45)).point).toEqual([10, 0, 15])
    const slanted = faceReference([1, 1, 1], [1, 1, 1], box(30))
    expect(slanted.anchor).toBeUndefined()
  })

  it('stays put when the extrusion it names is gone', () => {
    const reference = faceReference([2, 3, 30], [0, 0, 1], box(30))
    expect(currentFaceReference(reference, []).point).toEqual([2, 3, 30])
  })

  it('refuses walls with no thickness', () => {
    expect(shellProblem({ thickness: 2 })).toBeNull()
    expect(shellProblem({ thickness: 0 })).toMatch(/more than zero/)
    expect(shellProblem({ thickness: Number.NaN })).toMatch(/more than zero/)
  })

  it('knows a second pick on a face is the same face', () => {
    const top = { point: [0, 0, 30] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }
    expect(sameFace(top, { point: [5, -4, 30], normal: [0, 0, 1] })).toBe(true)
    expect(sameFace(top, { point: [5, -4, 28], normal: [0, 0, 1] })).toBe(false)
    expect(sameFace(top, { point: [0, 0, 30], normal: [0, 0, -1] })).toBe(false)
  })
})
