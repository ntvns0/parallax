import { describe, expect, it } from 'vitest'
import { normalizeArc } from '../core/arc-geometry'
import type { ArcEntity, LineEntity } from '../core/model'
import { tangentSourceAtPoint } from './tangent-arc'

describe('tangent arc endpoint selection', () => {
  it('continues outward from either end of a line', () => {
    const line: LineEntity = { id: 'line', type: 'line', start: [0, 0], end: [10, 0], construction: false }
    expect(tangentSourceAtPoint(line, [10, 0], 0.1)).toEqual({
      entityId: 'line', pointRef: 'end', point: [10, 0], tangent: [10, 0],
    })
    expect(tangentSourceAtPoint(line, [0, 0], 0.1)?.tangent).toEqual([-10, 0])
  })

  it('uses the circular tangent at an arc endpoint', () => {
    const geometry = normalizeArc([0, 0], 5, 0, Math.PI / 2)
    const arc: ArcEntity = { id: 'arc', type: 'arc', ...geometry, construction: false }
    const end = tangentSourceAtPoint(arc, [0, 5], 0.1)!
    expect(end.pointRef).toBe('end')
    expect(end.tangent[0]).toBeCloseTo(-1, 9)
    expect(end.tangent[1]).toBeCloseTo(0, 9)
    const start = tangentSourceAtPoint(arc, [5, 0], 0.1)!
    expect(start.pointRef).toBe('start')
    expect(start.tangent[0]).toBeCloseTo(0, 9)
    expect(start.tangent[1]).toBeCloseTo(-1, 9)
  })

  it('requires a click near an endpoint and rejects circles', () => {
    const line: LineEntity = { id: 'line', type: 'line', start: [0, 0], end: [10, 0], construction: false }
    expect(tangentSourceAtPoint(line, [5, 0], 0.1)).toBeNull()
    expect(tangentSourceAtPoint({ id: 'circle', type: 'circle', center: [0, 0], radius: 5, construction: false }, [5, 0], 0.1)).toBeNull()
  })
})
