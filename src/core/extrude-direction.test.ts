import { describe, expect, it } from 'vitest'
import { distanceForOperation, operationForDistance, planeNormalDistance } from './extrude-direction'

describe('planeNormalDistance', () => {
  it('passes a base-plane distance through untouched', () => {
    expect(planeNormalDistance(25, undefined)).toBe(25)
    expect(planeNormalDistance(-25, undefined)).toBe(-25)
  })

  it('measures a distance on an outward-facing face along the plane normal', () => {
    // Top face of a box: outward is +Z, which is also the XY plane normal.
    expect(planeNormalDistance(-6, 1)).toBe(-6)
  })

  it('flips a distance on an inward-facing face', () => {
    // Bottom face: outward is -Z, so digging in means going *up* the plane normal.
    expect(planeNormalDistance(-6, -1)).toBe(6)
  })
})

describe('operationForDistance', () => {
  it('reads growing away from the solid as adding material', () => {
    expect(operationForDistance(6, 'cut')).toBe('add')
  })

  it('reads digging into the solid as removing material', () => {
    expect(operationForDistance(-6, 'add')).toBe('cut')
  })

  it('never infers a deliberate new body away', () => {
    expect(operationForDistance(-6, 'newBody')).toBe('newBody')
    expect(operationForDistance(6, 'newBody')).toBe('newBody')
  })
})

describe('distanceForOperation', () => {
  it('turns the extent inward for a cut and outward for an add', () => {
    expect(distanceForOperation(6, 'cut')).toBe(-6)
    expect(distanceForOperation(-6, 'add')).toBe(6)
  })

  it('keeps the magnitude the user typed', () => {
    expect(distanceForOperation(-6, 'cut')).toBe(-6)
    expect(distanceForOperation(6, 'add')).toBe(6)
  })

  it('leaves a new body pointing wherever it was', () => {
    expect(distanceForOperation(-6, 'newBody')).toBe(-6)
  })

  it('round-trips: setting an operation then reading it back agrees', () => {
    for (const operation of ['add', 'cut'] as const) {
      expect(operationForDistance(distanceForOperation(25, operation), 'add')).toBe(operation)
    }
  })
})
