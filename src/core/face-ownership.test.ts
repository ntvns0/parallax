import { describe, expect, it } from 'vitest'
import { attributeFaces, type FaceSample } from './face-ownership'
import type { Feature, Vec2, Vec3 } from './model'

function rectangleEntities(prefix: string, cx: number, cy: number, width: number, height: number) {
  const corners: Vec2[] = [
    [cx - width / 2, cy - height / 2], [cx + width / 2, cy - height / 2],
    [cx + width / 2, cy + height / 2], [cx - width / 2, cy + height / 2],
  ]
  return corners.map((corner, index) => ({
    id: `${prefix}-${index}`, type: 'line' as const, start: corner, end: corners[(index + 1) % 4], construction: false,
  }))
}

/** A 100x60x20 plate with a 40x24 pocket 6mm into its top, and a fillet. */
function plateWithPocket(): Feature[] {
  return [
    {
      id: 'sketch-1', kind: 'sketch', name: 'Sketch 1', plane: 'XY',
      parameters: { planeOffset: 0 }, entities: rectangleEntities('base', 0, 0, 100, 60),
      constraints: [], position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    },
    {
      id: 'extrude-1', kind: 'extrude', name: 'Extrude 1',
      parameters: { distance: 20, symmetric: false, edgeRadius: 0 },
      sketchId: 'sketch-1', operation: 'newBody', position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    },
    {
      id: 'sketch-2', kind: 'sketch', name: 'Sketch 2', plane: 'XY',
      parameters: { planeOffset: 20, faceNormalSign: 1 }, entities: rectangleEntities('pocket', 0, 0, 40, 24),
      constraints: [], position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    },
    {
      id: 'extrude-2', kind: 'extrude', name: 'Extrude 2',
      parameters: { distance: -6, symmetric: false, edgeRadius: 0 },
      sketchId: 'sketch-2', operation: 'cut', position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    },
    {
      id: 'fillet-1', kind: 'fillet', name: 'Fillet 1', parameters: { radius: 2 },
      edges: [{ start: [20, -12, 20], end: [20, -12, 14], point: [20, -12, 17] }],
      position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    },
  ] as Feature[]
}

const planarFace = (points: Vec3[]): FaceSample => ({ points, planar: true })
const curvedFace = (points: Vec3[]): FaceSample => ({ points, planar: false })

describe('attributeFaces', () => {
  const features = plateWithPocket()
  const owners = (faces: FaceSample[]) => attributeFaces(faces, features)

  it('gives the plate its own outer wall', () => {
    // The x = 50 side of the base rectangle, spanning the full height.
    expect(owners([planarFace([[50, -20, 2], [50, 10, 12], [50, 25, 19]])])).toEqual(['extrude-1'])
  })

  it('gives the plate its top face, even where the pocket trimmed it', () => {
    // Still at z = 20 and still inside the base profile, just not the middle.
    expect(owners([planarFace([[-45, -25, 20], [-35, 0, 20], [-30, 25, 20]])])).toEqual(['extrude-1'])
  })

  it('gives the pocket its walls', () => {
    // The y = -12 wall of the pocket, between the floor and the top face.
    expect(owners([planarFace([[-10, -12, 15], [0, -12, 17], [10, -12, 19.5]])])).toEqual(['extrude-2'])
  })

  it('gives the pocket its floor', () => {
    expect(owners([planarFace([[-10, -5, 14], [0, 0, 14], [10, 5, 14]])])).toEqual(['extrude-2'])
  })

  it('gives the fillet its rounded surface', () => {
    // An arc of radius 2 around the pocket corner at (20, -12).
    expect(owners([curvedFace([[18.6, -12.3, 16], [18.3, -11.4, 17], [19.4, -10.6, 18]])])).toEqual(['fillet-1'])
  })

  it('does not hand a flat face to a fillet just for being nearby', () => {
    // These points sit within 2mm of the filleted edge but the face is planar,
    // so it is pocket wall rather than fillet surface.
    expect(owners([planarFace([[19, -12, 16], [19.5, -12, 17]])])).toEqual(['extrude-2'])
  })

  it('leaves a face nothing explains unowned rather than guessing', () => {
    expect(owners([planarFace([[500, 500, 500]])])).toEqual([null])
  })

  it('attributes a whole set in one pass', () => {
    expect(owners([
      planarFace([[50, 0, 10]]),
      planarFace([[0, -12, 17]]),
      curvedFace([[18.6, -12.3, 16], [18.3, -11.4, 17]]),
    ])).toEqual(['extrude-1', 'extrude-2', 'fillet-1'])
  })
})
