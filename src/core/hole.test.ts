import { describe, expect, it } from 'vitest'
import {
  applyHolePreset,
  countersinkDepth,
  defaultHoleParameters,
  holeCallout,
  holePlacements,
  holeProblem,
  holeSection,
  holeVolume,
  HOLE_OVERSHOOT_MM,
  HOLE_PRESETS,
} from './hole'
import { createHoleFeature, type Feature, type HoleParameters, type SketchEntity, type SketchFeature } from './model'

function sketchOf(entities: SketchEntity[], extra: Partial<SketchFeature> = {}): SketchFeature {
  return {
    id: 'holes', kind: 'sketch', name: 'Holes', plane: 'XY', parameters: { planeOffset: 6 }, entities, constraints: [],
    position: [0, 0, 0], rotation: [0, 0, 0], visible: true, ...extra,
  } as SketchFeature
}

const point = (id: string, at: [number, number], construction = false): SketchEntity => ({ id, type: 'point', position: at, construction })
const simple: HoleParameters = { form: 'simple', diameter: 4, depth: 10, through: false, headDiameter: 8, headDepth: 3, countersinkAngle: 90 }

describe('holePlacements', () => {
  it('drills at each point of the sketch, down into a base-plane sketch', () => {
    const sketch = sketchOf([point('a', [5, 5]), point('b', [15, 5]), point('datum', [0, 0], true)])
    const placements = holePlacements(createHoleFeature(sketch.id, 1, simple), [sketch])
    expect(placements).toEqual([
      { pointId: 'a', origin: [5, 5, 6], direction: [0, 0, -1] },
      { pointId: 'b', origin: [15, 5, 6], direction: [0, 0, -1] },
    ])
  })

  it('drills against a face sketch’s outward normal', () => {
    // A face whose outward normal is -Z, the bottom of a part, drills up.
    const sketch = sketchOf([point('a', [1, 2])], { parameters: { planeOffset: 0, faceNormalSign: -1 } })
    expect(holePlacements(createHoleFeature(sketch.id, 1, simple), [sketch])[0].direction).toEqual([0, 0, 1])
  })

  it('drills an XZ sketch along +Y, since that plane’s offset grows toward -Y', () => {
    const sketch = sketchOf([point('a', [1, 2])], { plane: 'XZ', parameters: { planeOffset: 0 } })
    expect(holePlacements(createHoleFeature(sketch.id, 1, simple), [sketch])[0]).toMatchObject({ origin: [1, -0, 2], direction: [0, 1, 0] })
  })

  it('drills nothing for a missing sketch, or one with no points', () => {
    const hole = createHoleFeature('gone', 1, simple)
    expect(holePlacements(hole, [])).toEqual([])
    const lines = sketchOf([{ id: 'l', type: 'line', start: [0, 0], end: [1, 0], construction: false }])
    expect(holePlacements({ ...hole, sketchId: lines.id }, [lines] as Feature[])).toEqual([])
  })
})

describe('holeSection', () => {
  it('outlines a plain bore, starting above the surface', () => {
    expect(holeSection(simple, 10)).toEqual([[0, -HOLE_OVERSHOOT_MM], [2, -HOLE_OVERSHOOT_MM], [2, 10], [0, 10]])
  })

  it('steps out for a counterbore', () => {
    expect(holeSection({ ...simple, form: 'counterbore' }, 10)).toEqual([
      [0, -HOLE_OVERSHOOT_MM], [4, -HOLE_OVERSHOOT_MM], [4, 3], [2, 3], [2, 10], [0, 10],
    ])
  })

  it('cones in for a countersink, as deep as its angle needs', () => {
    // A 90° countersink from Ø8 to Ø4 is 2 deep.
    expect(countersinkDepth({ diameter: 4, headDiameter: 8, countersinkAngle: 90 })).toBeCloseTo(2, 12)
    const section = holeSection({ ...simple, form: 'countersink' }, 10)
    expect(section[2]).toEqual([4, 0])
    expect(section[3][0]).toBe(2)
    expect(section[3][1]).toBeCloseTo(2, 12)
  })
})

describe('holeVolume', () => {
  it('is a cylinder, a stepped pair, or a frustum on a cylinder', () => {
    expect(holeVolume(simple, 10)).toBeCloseTo(Math.PI * 4 * 10, 9)
    expect(holeVolume({ ...simple, form: 'counterbore' }, 10)).toBeCloseTo(Math.PI * (16 * 3 + 4 * 7), 9)
    expect(holeVolume({ ...simple, form: 'countersink' }, 10)).toBeCloseTo(Math.PI * 2 * (16 + 8 + 4) / 3 + Math.PI * 4 * 8, 9)
  })
})

describe('holeProblem', () => {
  it('accepts a sound hole, and says what is wrong with an unsound one', () => {
    expect(holeProblem(simple)).toBeNull()
    expect(holeProblem({ ...simple, diameter: 0 })).toMatch(/diameter/)
    expect(holeProblem({ ...simple, form: 'counterbore', headDiameter: 3 })).toMatch(/larger than the hole/)
    expect(holeProblem({ ...simple, form: 'counterbore', headDepth: 12 })).toMatch(/as deep as the hole/)
    // Through, the depth no longer limits the head.
    expect(holeProblem({ ...simple, form: 'counterbore', headDepth: 12, through: true })).toBeNull()
  })
})

describe('presets', () => {
  it('sizes a hole from a preset and records which one', () => {
    const sized = applyHolePreset(simple, 'M4 counterbore')
    expect(sized).toMatchObject({ form: 'counterbore', diameter: 4.5, headDiameter: 8, headDepth: 4.4, depth: 10, preset: 'M4 counterbore' })
  })

  it('gives an insert bore its own depth, blind', () => {
    expect(applyHolePreset({ ...simple, through: true }, 'M3 heat-set insert')).toMatchObject({ diameter: 4, depth: 6, through: false })
  })

  it('has a sound hole for every preset', () => {
    for (const preset of HOLE_PRESETS) expect(holeProblem(applyHolePreset({ ...simple, depth: 20 }, preset.name)), preset.name).toBeNull()
  })

  it('starts a new hole as an M3 clearance hole through the part', () => {
    expect(defaultHoleParameters()).toMatchObject({ form: 'simple', diameter: 3.4, through: true, preset: 'M3 clearance' })
  })
})

describe('holeCallout', () => {
  const mm = (value: number) => String(value)
  it('reads like a drawing callout', () => {
    expect(holeCallout({ ...simple, through: true }, mm)).toBe('Ø4 THRU')
    expect(holeCallout({ ...simple, form: 'counterbore' }, mm)).toBe('Ø4 ↧ 10 ⌴ Ø8 ↧ 3')
    expect(holeCallout({ ...simple, form: 'countersink' }, mm)).toBe('Ø4 ↧ 10 ⌵ Ø8 × 90°')
  })
})
