import { describe, expect, it } from 'vitest'
import { CUT_ENTRY_OVERSHOOT_MM, extrudeExtent, extrudeReach } from './extrude-extent'

describe('extrusion extents', () => {
  it('starts a new body on the sketch plane', () => {
    const extent = extrudeExtent({ distance: 10, symmetric: false, operation: 'newBody' })
    expect(extrudeReach(extent)).toEqual({ start: 0, end: 10 })
    expect(extent.origin).toBeUndefined()
  })

  it('straddles the sketch plane when symmetric', () => {
    const extent = extrudeExtent({ distance: 10, symmetric: true, operation: 'newBody' })
    expect(extrudeReach(extent)).toEqual({ start: -5, end: 5 })
  })

  it('keeps the cut depth exact while overshooting the entry face', () => {
    const extent = extrudeExtent({ distance: 10, symmetric: false, operation: 'cut' })
    const reach = extrudeReach(extent)

    // The tool starts behind the entry face so the boolean has no coplanar
    // pair, but the far end still lands exactly 10 mm from the sketch plane.
    expect(reach.start).toBeCloseTo(-CUT_ENTRY_OVERSHOOT_MM, 12)
    expect(reach.end).toBeCloseTo(10, 12)
  })

  it('overshoots the correct side when cutting in the negative direction', () => {
    const reach = extrudeReach(extrudeExtent({ distance: -10, symmetric: false, operation: 'cut' }))
    expect(reach.start).toBeCloseTo(CUT_ENTRY_OVERSHOOT_MM, 12)
    expect(reach.end).toBeCloseTo(-10, 12)
  })

  it('does not overshoot a symmetric cut, which has no single entry face', () => {
    const reach = extrudeReach(extrudeExtent({ distance: 10, symmetric: true, operation: 'cut' }))
    expect(reach).toEqual({ start: -5, end: 5 })
  })

  it('does not overshoot additive extrusions', () => {
    const reach = extrudeReach(extrudeExtent({ distance: 8, symmetric: false, operation: 'add' }))
    expect(reach).toEqual({ start: 0, end: 8 })
  })
})
