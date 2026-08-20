import { describe, expect, it } from 'vitest'
import type { SketchFaceAttachment } from './model'
import { snapToFaceReference } from './face-reference'

const attachment: SketchFaceAttachment = {
  type: 'face',
  featureId: 'box',
  featureName: 'Extrude 1',
  faceLabel: 'Front face',
  center: [10, 5],
  bounds: { min: [0, 0], max: [20, 10] },
  edges: [
    { start: [0, 0], end: [20, 0] },
    { start: [20, 0], end: [20, 10] },
    { start: [20, 10], end: [0, 10] },
    { start: [0, 10], end: [0, 0] },
  ],
  area: 200,
}

describe('face reference snapping', () => {
  it('snaps to the face center', () => {
    expect(snapToFaceReference([10.4, 5.2], attachment, 1)).toMatchObject({ point: [10, 5], kind: 'center' })
  })

  it('snaps to an edge midpoint and an arbitrary edge point', () => {
    expect(snapToFaceReference([10.1, 0.2], attachment, 0.5)).toMatchObject({ point: [10, 0], kind: 'midpoint' })
    expect(snapToFaceReference([4, 0.2], attachment, 0.5)).toMatchObject({ point: [4, 0], kind: 'edge' })
  })

  it('does not snap outside the requested tolerance', () => {
    expect(snapToFaceReference([4, 4], attachment, 0.5)).toBeNull()
  })
})
