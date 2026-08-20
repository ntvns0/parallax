import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import { draw, setOC, type Shape3D } from 'replicad'
import { FILLET_SCALE_TOLERANCE, describeOversizedFillet, largestWorkingScale } from './fillet-limit'

const WASM = resolve(process.cwd(), 'node_modules/replicad-opencascadejs/src/replicad_single.wasm')

describe('largestWorkingScale', () => {
  it('finds the boundary of a size limit', () => {
    // Accepts anything up to 40% of what was asked for.
    const scale = largestWorkingScale((value) => value <= 0.4)
    expect(scale).toBeLessThanOrEqual(0.4)
    expect(scale).toBeGreaterThan(0.4 - FILLET_SCALE_TOLERANCE * 2)
  })

  it('reports zero when nothing works', () => {
    expect(largestWorkingScale(() => false)).toBe(0)
  })

  it('never returns a scale the predicate rejected', () => {
    const tried: number[] = []
    const scale = largestWorkingScale((value) => {
      tried.push(value)
      return value <= 0.63
    })
    expect(scale).toBeLessThanOrEqual(0.63)
    // Every probe stays inside the range it is searching.
    for (const value of tried) expect(value).toBeGreaterThan(0)
  })

  it('terminates even when the predicate always succeeds', () => {
    const scale = largestWorkingScale(() => true)
    expect(scale).toBeGreaterThan(1 - FILLET_SCALE_TOLERANCE * 2)
  })
})

describe('describeOversizedFillet', () => {
  it('quotes a radius that works, not the one that failed', () => {
    const message = describeOversizedFillet('Fillet 1', 15, 0.66, 1)
    expect(message).toContain('15 mm radius')
    expect(message).toContain('9.90 mm')
  })

  it('blames the selection when no radius at all works', () => {
    const message = describeOversizedFillet('Fillet 1', 5, 0, 1)
    expect(message).toContain('could not be built at any radius')
    expect(message).toContain('meet at a corner')
  })

  it('mentions the neighbours when the fillet is part of a run', () => {
    expect(describeOversizedFillet('Fillet 2', 8, 0.5, 3)).toContain('with the other fillets it meets')
  })
})

/**
 * The claim that matters: the radius we quote back actually builds.
 *
 * A limit worked out from a predicate is only useful if it survives contact
 * with OpenCascade, so this runs the search against the real kernel and then
 * builds the fillet it recommends.
 */
describe('against the exact kernel', () => {
  beforeAll(async () => {
    const init = initOpenCascade as unknown as (
      config: { locateFile: () => string; wasmBinary: Buffer },
    ) => Promise<Parameters<typeof setOC>[0]>
    setOC(await init({ locateFile: () => WASM, wasmBinary: readFileSync(WASM) }))
  }, 120_000)

  /** A 20 x 20 x 10 plate. Its vertical edges cannot take a fillet past 10 mm. */
  function plate(): Shape3D {
    return draw([0, 0])
      .lineTo([20, 0])
      .lineTo([20, 20])
      .lineTo([0, 20])
      .close()
      .sketchOnPlane('XY', 0)
      .extrude(10) as Shape3D
  }

  function filletsAt(shape: Shape3D, radius: number): Shape3D | null {
    try {
      return shape.fillet(radius, (edges) => edges.inDirection('Z')) as Shape3D
    } catch {
      return null
    }
  }

  it('refuses a radius wider than the face it must sit on', () => {
    const solid = plate()
    // Half the plate is 10 mm, so a 15 mm round on every vertical edge cannot fit.
    expect(filletsAt(solid, 15)).toBeNull()
    solid.delete()
  })

  it('recommends a radius that then builds', () => {
    const solid = plate()
    const requested = 15
    const scale = largestWorkingScale((value) => {
      const probe = filletsAt(solid, requested * value)
      probe?.delete()
      return probe !== null
    })

    expect(scale).toBeGreaterThan(0)
    expect(scale).toBeLessThan(1)

    const recommended = requested * scale
    // The plate's half-width is the real ceiling; the search should land just under it.
    expect(recommended).toBeLessThanOrEqual(10)
    expect(recommended).toBeGreaterThan(8)

    const built = filletsAt(solid, recommended)
    expect(built).not.toBeNull()
    built?.delete()
    solid.delete()
  }, 120_000)
})
