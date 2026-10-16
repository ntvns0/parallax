import { describe, expect, it } from 'vitest'
import { createPatternFeature, type Feature, type PatternParameters, type Vec3 } from './model'
import {
  defaultPatternParameters,
  describePattern,
  patternCopyCount,
  patternProblem,
  patternSeeds,
  patternTransforms,
  transformPoint,
} from './pattern'

const rounded = (point: Vec3) => point.map((value) => Math.round(value * 1e9) / 1e9 + 0)
const linear = (overrides: Partial<PatternParameters> = {}): PatternParameters => ({ ...defaultPatternParameters('linear'), ...overrides })

describe('patternTransforms', () => {
  it('steps a row along its direction, the original left where it is', () => {
    const transforms = patternTransforms(linear({ count: 3, spacing: -5, direction: 'Y' }))
    expect(transforms).toEqual([{ kind: 'translate', offset: [0, -5, 0] }, { kind: 'translate', offset: [0, -10, 0] }])
  })

  it('makes a grid from a second direction', () => {
    const transforms = patternTransforms(linear({ count: 2, spacing: 10, count2: 2, spacing2: 4, direction2: 'Y' }))
    expect(transforms.map((transform) => transform.kind === 'translate' && transform.offset)).toEqual([[10, 0, 0], [0, 4, 0], [10, 4, 0]])
    expect(patternCopyCount(linear({ count: 2, count2: 2 }))).toBe(3)
  })

  it('spaces a full turn evenly, and a partial span end to end', () => {
    const full = patternTransforms({ ...defaultPatternParameters('circular'), count: 4 })
    expect(full.map((transform) => transform.kind === 'rotate' && transform.degrees)).toEqual([90, 180, 270])
    const half = patternTransforms({ ...defaultPatternParameters('circular'), count: 3, angle: 180 })
    expect(half.map((transform) => transform.kind === 'rotate' && transform.degrees)).toEqual([90, 180])
  })

  it('moves a point where the kernel will move the shape', () => {
    const [quarter] = patternTransforms({ ...defaultPatternParameters('circular'), count: 4, origin: [5, 0, 0] })
    expect(rounded(transformPoint([15, 0, 3], quarter))).toEqual([5, 10, 3])
    const [mirror] = patternTransforms({ ...defaultPatternParameters('mirror'), direction: 'X', origin: [2, 0, 0] })
    expect(transformPoint([5, 1, 1], mirror)).toEqual([-1, 1, 1])
  })

  it('makes nothing from numbers that make no pattern', () => {
    expect(patternTransforms(linear({ count: 2.5 }))).toEqual([])
    expect(patternProblem(linear({ count: 0 }))).toMatch(/whole number/)
    expect(patternProblem(linear({ count: 3, spacing: 0 }))).toMatch(/spacing/)
    expect(patternProblem(linear({ count2: 2, direction2: 'X' }))).toMatch(/must differ/)
    expect(patternProblem({ ...defaultPatternParameters('circular'), angle: 0 })).toMatch(/360/)
    expect(patternProblem(linear({ count: 1000 }))).toMatch(/at most/)
  })
})

describe('patternSeeds', () => {
  const feature = (id: string, kind: Feature['kind']) => ({ id, kind } as Feature)

  it('copies only earlier extrusions, revolves and holes that still exist', () => {
    const pattern = createPatternFeature(['cut', 'round', 'gone', 'later'], 1, linear())
    const features = [feature('cut', 'extrude'), feature('round', 'fillet'), pattern, feature('later', 'hole')]
    expect(patternSeeds(pattern, features).map((seed) => seed.id)).toEqual(['cut'])
  })
})

describe('describePattern', () => {
  const mm = (value: number) => `${value} mm`
  it('says what the pattern does in a line', () => {
    expect(describePattern(linear({ count: 3, spacing: 12 }), mm)).toBe('3 × 12 mm along X')
    expect(describePattern(linear({ count: 2, count2: 3, spacing2: 5 }), mm)).toBe('2 × 10 mm along X, 3 × 5 mm along Y')
    expect(describePattern({ ...defaultPatternParameters('circular'), count: 24 }, mm)).toBe('24 × round Z')
    expect(describePattern({ ...defaultPatternParameters('mirror'), origin: [3, 0, 0] }, mm)).toBe('Mirrored across YZ at 3 mm')
  })

  it('names a mirror as a mirror', () => {
    expect(createPatternFeature([], 2, defaultPatternParameters('mirror')).name).toBe('Mirror 2')
  })
})
