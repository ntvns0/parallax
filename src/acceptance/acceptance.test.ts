import { appendFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspectPart, loadKernels, roundTrip, solidCacheKey, withParameters } from './harness'
import { buildKnob, knobVolume } from './parts/knob'
import { buildLBracket, lBracketVolume } from './parts/l-bracket'

/**
 * The acceptance parts: the progress bar for ROADMAP.md.
 *
 * Each part is checked three ways — its geometry against hand-computed
 * values, an edit to its named parameters that it has to survive, and a save
 * and reload. A part that cannot be fully built yet is built as far as Parallax
 * allows, and the rest is a `todo` naming what it waits for.
 */

type Progress = { id: string; name: string; missing: string[] }
const progress: Progress[] = [
  { id: 'A1', name: 'Screw-mount L-bracket', missing: [] },
  { id: 'A2', name: 'Desk cable clip', missing: ['sketch offset', 'mirror', 'Hole feature'] },
  { id: 'A3', name: 'Electronics enclosure with lid', missing: ['shell', 'multiple bodies', 'rectangular pattern', 'Hole feature', 'per-body export'] },
  { id: 'A4', name: 'Parametric knob', missing: [] },
]

beforeAll(loadKernels, 120_000)

afterAll(() => {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  const rows = progress.map((part) => `| ${part.id} | ${part.name} | ${part.missing.length ? `⬜ needs ${part.missing.join(', ')}` : '✅'} |`)
  appendFileSync(summary, ['### Acceptance parts', '', '| Part | | Status |', '| --- | --- | --- |', ...rows, ''].join('\n'))
})

for (const part of progress) {
  if (part.missing.length) it.todo(`${part.id} ${part.name}: complete once Parallax has ${part.missing.join(', ')}`)
}

describe('A1 screw-mount L-bracket', () => {
  const nominal = { t: 4, length: 50, height: 30, width: 40, r: 4, c: 1, n: 2 }

  it('builds to the hand-computed geometry', () => {
    const report = inspectPart(buildLBracket())

    expect(report.valid).toBe(true)
    expect(report.bodies).toBe(1)
    expect(report.volume).toBeCloseTo(lBracketVolume(nominal), 3)
    expect(report.min).toEqual([0, -40, 0])
    expect(report.max).toEqual([50, 0, 30])
  })

  it('survives a thicker plate, a narrower bracket, a bigger chamfer, and three holes a leg', () => {
    // The fillet is anchored to the sketch corner, so it has to follow the
    // inside corner out to 6 mm rather than look for it where it used to be.
    const edited = withParameters(buildLBracket(), { thickness: '6', width: '30', outside_chamfer: '1.5', holes_per_leg: '3' })
    const report = inspectPart(edited)

    expect(report.valid).toBe(true)
    expect(report.volume).toBeCloseTo(lBracketVolume({ ...nominal, t: 6, width: 30, c: 1.5, n: 3 }), 3)
    expect(report.min).toEqual([0, -30, 0])
  })

  it('reopens as the same solid', () => {
    const part = buildLBracket()
    expect(solidCacheKey(roundTrip(part))).toBe(solidCacheKey(part))
  })
})

describe('A4 parametric knob', () => {
  const nominal = { radius: 15, height: 12, shaft: 6, flat: 4.5, clearance: 0.2, depth: 10, c: 1, grooves: 24, g: 1 }

  it('builds to the hand-computed geometry', () => {
    const report = inspectPart(buildKnob())

    expect(report.valid).toBe(true)
    expect(report.bodies).toBe(1)
    expect(report.volume).toBeCloseTo(knobVolume(nominal), 2)
    expect(report.min).toEqual([-15, -15, 0])
    expect(report.max).toEqual([15, 15, 12])
  })

  it('survives fewer grooves, a smaller shaft, more clearance, and a larger knob', () => {
    // The chamfered rim moves out to radius 20 with the knob. Its anchor names
    // the section corner that swept it, not where the rim used to be.
    const edited = withParameters(buildKnob(), { grooves: '18', shaft: '5', flat: '3.8', clearance: '0.3', knob_radius: '20' })
    const report = inspectPart(edited)

    expect(report.valid).toBe(true)
    expect(report.volume).toBeCloseTo(knobVolume({ ...nominal, grooves: 18, radius: 20, shaft: 5, flat: 3.8, clearance: 0.3 }), 2)
    expect(report.max).toEqual([20, 20, 12])
  })

  it('reopens as the same solid', () => {
    const part = buildKnob()
    expect(solidCacheKey(roundTrip(part))).toBe(solidCacheKey(part))
  })
})
