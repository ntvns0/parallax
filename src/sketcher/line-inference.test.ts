import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../core/model'
import { beginAngleBreakaway, inferredLineAngle, snapLineEnd, updateAngleBreakaway } from './line-inference'

function pointAt(degrees: number, length = 10): Vec2 {
  const radians = degrees * Math.PI / 180
  return [Math.cos(radians) * length, Math.sin(radians) * length]
}

describe('smart line angle inference', () => {
  it.each([0, 45, 90, 135])('acquires the common %d° mark', (degrees) => {
    const snapped = snapLineEnd([0, 0], pointAt(degrees + 2), 0)
    expect(Math.atan2(snapped[1], snapped[0]) * 180 / Math.PI).toBeCloseTo(degrees, 8)
    expect(Math.hypot(...snapped)).toBeCloseTo(10, 8)
  })

  it('leaves an arbitrary angle free outside the magnetic window', () => {
    const end = pointAt(37)
    expect(snapLineEnd([0, 0], end, 0)).toEqual(end)
    expect(inferredLineAngle([0, 0], end, 0)).toBeNull()
  })

  it('keeps explicit increments strict and snaps length to the grid', () => {
    const snapped = snapLineEnd([0, 0], pointAt(22, 10.4), 15, 1)
    expect(Math.atan2(snapped[1], snapped[0]) * 180 / Math.PI).toBeCloseTo(15, 8)
    expect(Math.hypot(...snapped)).toBeCloseTo(10, 8)
  })

  it('reports an angle on a geometry target only when it matches exactly', () => {
    expect(inferredLineAngle([0, 0], pointAt(45), 0, true)).toBeCloseTo(Math.PI / 4)
    expect(inferredLineAngle([0, 0], pointAt(44.9), 0, true)).toBeNull()
    expect(inferredLineAngle([0, 0], pointAt(29), 15, true)).toBeNull()
  })

  it('releases a common-angle latch during a slow deliberate adjustment', () => {
    let state = beginAngleBreakaway([100, 100], 0)
    state = updateAngleBreakaway(state, [0, 0], pointAt(45), [110, 90], 16)
    expect(state.fine).toBe(false)
    state = updateAngleBreakaway(state, [0, 0], pointAt(46), [111, 89], 32)
    expect(state.fine).toBe(true)
    expect(snapLineEnd([0, 0], pointAt(46), 0, 1, state.fine ? 0.25 : 4)).toEqual(pointAt(46))
  })

  it('keeps the magnetic latch during a fast pass through 46°', () => {
    let state = beginAngleBreakaway([100, 100], 0)
    state = updateAngleBreakaway(state, [0, 0], pointAt(45), [130, 70], 16)
    state = updateAngleBreakaway(state, [0, 0], pointAt(46), [160, 40], 32)
    expect(state.fine).toBe(false)
  })
})
