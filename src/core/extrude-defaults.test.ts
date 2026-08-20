import { describe, expect, it } from 'vitest'
import { defaultExtrudeDistance, materialDepthUnderSketch, FALLBACK_EXTRUDE_DISTANCE_MM } from './extrude-defaults'

/** Corner vertices of an axis-aligned box, flattened the way the kernel returns them. */
function boxVertices(min: [number, number, number], max: [number, number, number]) {
  const out: number[] = []
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push(x, y, z)
  return out
}

describe('materialDepthUnderSketch', () => {
  const box = boxVertices([-50, -30, 0], [50, 30, 20])

  it('measures down to the far side from a top face', () => {
    // Sketch on the top of a 20mm-thick box: 20mm of material sits under it.
    expect(materialDepthUnderSketch(box, 'XY', 20, 1)).toBeCloseTo(20)
  })

  it('measures up to the far side from a bottom face', () => {
    expect(materialDepthUnderSketch(box, 'XY', 0, -1)).toBeCloseTo(20)
  })

  it('measures across from a side face', () => {
    // YZ offset is +x; the right face is at x = 50 with 100mm behind it.
    expect(materialDepthUnderSketch(box, 'YZ', 50, 1)).toBeCloseTo(100)
  })

  it('handles the XZ sign convention', () => {
    // XZ offset is -y, so the face at y = -30 sits at offset +30.
    expect(materialDepthUnderSketch(box, 'XZ', 30, 1)).toBeCloseTo(60)
  })

  it('returns null when the sketch plane is not against the solid', () => {
    // A plane above the box has no material behind it in the outward sense.
    expect(materialDepthUnderSketch(box, 'XY', 20, -1)).toBeNull()
  })

  it('returns null for an empty mesh rather than guessing', () => {
    expect(materialDepthUnderSketch([], 'XY', 20, 1)).toBeNull()
  })
})

describe('defaultExtrudeDistance', () => {
  it('uses the measured depth so a flipped extrusion cuts clean through', () => {
    expect(defaultExtrudeDistance(20)).toBe(20)
  })

  it('falls back when there is nothing to measure', () => {
    expect(defaultExtrudeDistance(null)).toBe(FALLBACK_EXTRUDE_DISTANCE_MM)
  })
})
