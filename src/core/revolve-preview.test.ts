import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createRevolveToolGeometry } from './geometry'
import type { LineEntity, RevolveFeature, SketchFeature } from './model'

/** A 5 × 12 rectangle from x = 10 to 15 on XY, with a centreline at x = 5. */
function ringSection(): SketchFeature {
  const corners: [number, number][] = [[10, 0], [15, 0], [15, 12], [10, 12]]
  const sides: LineEntity[] = corners.map((start, index) => ({
    id: `side-${index}`, type: 'line', start, end: corners[(index + 1) % 4], construction: false,
  }))
  const centreline: LineEntity = { id: 'axis', type: 'line', start: [5, -5], end: [5, 20], construction: true }
  return {
    id: 'section', name: 'Section', kind: 'sketch', plane: 'XY', entities: [...sides, centreline], constraints: [],
    parameters: { planeOffset: 0 }, position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
  } as SketchFeature
}

function revolve(extra: Partial<RevolveFeature>): RevolveFeature {
  return {
    id: 'ring', name: 'Ring', kind: 'revolve', sketchId: 'section', operation: 'newBody',
    parameters: { angle: 360, axis: 'Y' }, position: [0, 0, 0], rotation: [0, 0, 0], visible: true, ...extra,
  }
}

function bounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox!
  return { min: min.toArray().map((value) => Math.round(value * 1000) / 1000 + 0), max: max.toArray().map((value) => Math.round(value * 1000) / 1000 + 0) }
}

describe('revolve preview', () => {
  it('turns about a centreline away from the origin', () => {
    // Radii 5 to 10 about the line x = 5: x from -5 to 15, z from -10 to 10.
    const preview = createRevolveToolGeometry(revolve({ axisEntityId: 'axis' }), [ringSection()])
    expect(bounds(preview)).toEqual({ min: [-5, 0, -10], max: [15, 12, 10] })
  })

  it('still turns about the sketch axis through the origin when no line is named', () => {
    const preview = createRevolveToolGeometry(revolve({}), [ringSection()])
    expect(bounds(preview)).toEqual({ min: [-15, 0, -15], max: [15, 12, 15] })
  })

  it('draws nothing when its axis line is gone', () => {
    const preview = createRevolveToolGeometry(revolve({ axisEntityId: 'deleted' }), [ringSection()])
    expect(preview.getAttribute('position')).toBeUndefined()
  })
})
