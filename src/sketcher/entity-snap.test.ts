import { describe, expect, it } from 'vitest'
import type { LineEntity, Vec2 } from '../core/model'
import { lineRulerAtPoint, reverseLineRuler, snapToSketchLines } from './entity-snap'

function line(id: string, start: Vec2, end: Vec2): LineEntity {
  return { id, type: 'line', start, end, construction: false }
}

describe('snapToSketchLines', () => {
  it('snaps to endpoints and records the named endpoint', () => {
    const snap = snapToSketchLines([0.4, 0.3], [line('line-1', [0, 0], [10, 0])], 1)
    expect(snap).toEqual({ point: [0, 0], kind: 'endpoint', entityIds: ['line-1'], pointRef: 'start' })
  })

  it('prefers a midpoint design target over the nearby generic projection', () => {
    const snap = snapToSketchLines([5.8, 0.1], [line('line-1', [0, 0], [10, 0])], 1)
    expect(snap).toMatchObject({ point: [5, 0], kind: 'midpoint', entityIds: ['line-1'] })
  })

  it('projects onto the finite segment away from special targets', () => {
    const snap = snapToSketchLines([7, 0.4], [line('line-1', [0, 0], [10, 0])], 1)
    expect(snap).toMatchObject({ point: [7, 0], kind: 'line' })
  })

  it('snaps to the crossing of two finite lines', () => {
    const lines = [
      line('horizontal', [0, 0], [10, 0]),
      line('vertical', [5, -5], [5, 5]),
    ]
    expect(snapToSketchLines([5.3, 0.2], lines, 0.5)).toEqual({
      point: [5, 0], kind: 'intersection', entityIds: ['horizontal', 'vertical'],
    })
  })

  it('does not use an intersection outside either finite segment', () => {
    const lines = [
      line('horizontal', [0, 0], [2, 0]),
      line('vertical', [5, -3], [5, 1]),
    ]
    expect(snapToSketchLines([5, 0], lines, 0.5)?.kind).toBe('line')
  })

  it('returns null outside the screen-derived tolerance', () => {
    expect(snapToSketchLines([5, 2], [line('line-1', [0, 0], [10, 0])], 1)).toBeNull()
  })
})

describe('lineRulerAtPoint', () => {
  it('shows 10 mm major ticks and expands the active interval to 1 mm', () => {
    const ruler = lineRulerAtPoint([66.2, 0.4], [line('line-1', [0, 0], [100, 0])], 2, 0.5, 10, 1)
    expect(ruler?.activeInterval).toEqual([60, 70])
    expect(ruler?.ticks.filter((tick) => tick.major).map((tick) => tick.distance))
      .toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(ruler?.ticks.some((tick) => tick.distance === 66 && !tick.major)).toBe(true)
    expect(ruler?.snap).toMatchObject({ kind: 'division', distance: 66, point: [66, 0], pointRef: 'start' })
  })

  it('can measure and snap from the opposite endpoint', () => {
    const ruler = lineRulerAtPoint([70.2, 0], [line('line-1', [0, 0], [100, 0])], 2, 0.5, 10, 1, 'end')
    expect(ruler?.projectedDistance).toBeCloseTo(29.8)
    expect(ruler?.snap).toMatchObject({ distance: 30, point: [70, 0], pointRef: 'end' })
  })

  it('reverses the datum while preserving the physical snap point', () => {
    const ruler = lineRulerAtPoint([30.1, 0], [line('line-1', [0, 0], [100, 0])], 2, 0.5, 10, 1)!
    const reversed = reverseLineRuler(ruler)
    expect(reversed.datum).toBe('end')
    expect(reversed.snap).toMatchObject({ point: [30, 0], distance: 70, pointRef: 'end' })
  })

  it('does not activate away from a line', () => {
    expect(lineRulerAtPoint([50, 5], [line('line-1', [0, 0], [100, 0])], 2, 0.5, 10, 1)).toBeNull()
  })
})
