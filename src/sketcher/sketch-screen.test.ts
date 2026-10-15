import { describe, expect, it } from 'vitest'
import { arcPath, screenMap } from './sketch-screen'

// 200 × 100 surface, 2 px/mm, no pan: model origin at screen (100, 50).
const screen = screenMap({ scale: 2, panX: 0, panY: 0 }, { width: 200, height: 100 })

describe('screenMap', () => {
  it('puts the model origin at the middle and turns +Y up into screen down', () => {
    expect(screen.toX(0)).toBe(100)
    expect(screen.toY(0)).toBe(50)
    expect(screen.toX(10)).toBe(120)
    expect(screen.toY(10)).toBe(30)
  })
})

describe('arcPath', () => {
  it('draws a quarter arc as one small clockwise screen arc', () => {
    // Centre at the origin, radius 10, from +X round to +Y.
    const path = arcPath({ center: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 2 }, screen)
    expect(path).toBe('M 120 50 A 20 20 0 0 1 100 30')
  })

  it('sets the large-arc flag past half a turn', () => {
    const path = arcPath({ center: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI * 1.5 }, screen)
    expect(path).toMatch(/ A 20 20 0 1 1 /)
  })

  it('draws a full turn as two halves, since one arc command cannot close on itself', () => {
    const path = arcPath({ center: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI * 2 }, screen)
    expect(path.match(/ A /g)).toHaveLength(2)
    expect(path.startsWith('M 120 50 ')).toBe(true)
    expect(path.endsWith(' 120 50')).toBe(true)
  })
})
