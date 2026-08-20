import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import { draw, setOC, type Shape3D } from 'replicad'
import { applyFilletGroup, edgeGeometry } from './fillet-apply'
import type { KernelFilletOperation } from './kernel-types'
import type { FilletEdgeReference, Vec3 } from '../core/model'

/**
 * What happens to a part when a fillet cannot be built.
 *
 * The rule under test is the one that used to be broken: a radius typed too
 * large is a problem with that feature, not with the model. The solid has to
 * survive, and the feature has to come back with a number the user can use.
 */

const WASM = resolve(process.cwd(), 'node_modules/replicad-opencascadejs/src/replicad_single.wasm')
const PLATE = 20
const THICKNESS = 10

beforeAll(async () => {
  const init = initOpenCascade as unknown as (
    config: { locateFile: () => string; wasmBinary: Buffer },
  ) => Promise<Parameters<typeof setOC>[0]>
  setOC(await init({ locateFile: () => WASM, wasmBinary: readFileSync(WASM) }))
}, 120_000)

/**
 * A 20 x 20 x 10 plate.
 *
 * Its fillet limit depends on how many corners are rounded at once: a single
 * corner is bounded by the 20 mm faces beside it, while all four together are
 * bounded by the 10 mm half-width where the blends meet. That difference is
 * why the limit is measured rather than assumed.
 */
function plate(): Shape3D {
  return draw([0, 0])
    .lineTo([PLATE, 0])
    .lineTo([PLATE, PLATE])
    .lineTo([0, PLATE])
    .close()
    .sketchOnPlane('XY', 0)
    .extrude(THICKNESS) as Shape3D
}

/** References for the plate's vertical corners, taken from the solid itself. */
function verticalEdgeReferences(shape: Shape3D): FilletEdgeReference[] {
  const found: FilletEdgeReference[] = []
  for (const edge of shape.edges) {
    const geometry = edgeGeometry(edge)
    const [sx, sy, sz] = geometry.start
    const [ex, ey, ez] = geometry.end
    // A vertical edge shares its X and Y and spans the full thickness.
    if (Math.abs(sx - ex) < 1e-6 && Math.abs(sy - ey) < 1e-6 && Math.abs(Math.abs(sz - ez) - THICKNESS) < 1e-6) {
      found.push({ start: geometry.start as Vec3, end: geometry.end as Vec3, point: geometry.middle as Vec3 })
    }
  }
  if (!found.length) throw new Error('no vertical edge found on the plate')
  return found
}

/**
 * One corner of the plate. Its limit is the 20 mm face on either side of it —
 * not the 10 mm half-width that bounds all four corners rounded together.
 */
function verticalEdgeReference(shape: Shape3D): FilletEdgeReference {
  return verticalEdgeReferences(shape)[0]
}

function filletOperation(edges: FilletEdgeReference[], radius: number): KernelFilletOperation {
  return {
    type: 'fillet',
    featureId: 'fillet-1',
    featureName: 'Fillet 1',
    radius,
    cornerStyle: 'spherical',
    filletShape: 'rational',
    edges,
  }
}

describe('applyFilletGroup', () => {
  it('builds a fillet that fits, and reports nothing', () => {
    const solid = plate()
    const result = applyFilletGroup(solid, [filletOperation([verticalEdgeReference(solid)], 3)])

    expect(result.unresolved).toEqual([])
    expect(result.shape).not.toBe(solid)
    result.shape.delete()
    solid.delete()
  }, 120_000)

  it('keeps the part when the radius is too large, and says what fits', () => {
    const solid = plate()
    // The faces meeting at this corner are 20 mm wide, so 30 mm cannot sit on them.
    const result = applyFilletGroup(solid, [filletOperation([verticalEdgeReference(solid)], 30)])

    // The solid passes through untouched rather than the evaluation failing.
    expect(result.shape).toBe(solid)
    expect(result.unresolved).toHaveLength(1)

    const [diagnostic] = result.unresolved
    expect(diagnostic.featureId).toBe('fillet-1')
    expect(diagnostic.message).toContain('too large')
    expect(diagnostic.message).toMatch(/largest that works here is about [\d.]+ mm/)
    expect(diagnostic.suggestedRadius).toBeTypeOf('number')
    expect(diagnostic).toMatchObject({
      code: 'oversized-fillet', reason: 'limit-exceeded', subject: { kind: 'parameter' },
      repairs: [expect.objectContaining({ kind: 'apply-radius' })],
    })

    solid.delete()
  }, 120_000)

  it('recommends a radius that really does build', () => {
    const solid = plate()
    const reference = verticalEdgeReference(solid)
    const result = applyFilletGroup(solid, [filletOperation([reference], 30)])

    const quoted = result.unresolved[0].message.match(/about ([\d.]+) mm/)
    expect(quoted).not.toBeNull()
    const recommended = Number(quoted![1])
    expect(result.unresolved[0].suggestedRadius).toBe(recommended)
    expect(recommended).toBeGreaterThan(0)
    // The 20 mm face is the real ceiling; the search should land just under it.
    expect(recommended).toBeLessThan(20)
    expect(recommended).toBeGreaterThan(15)

    // The promise the message makes, taken at its word.
    const retry = applyFilletGroup(solid, [filletOperation([reference], recommended)])
    expect(retry.unresolved).toEqual([])
    expect(retry.shape).not.toBe(solid)

    retry.shape.delete()
    solid.delete()
  }, 120_000)

  // The case a user actually hits: rounding every corner of a plate, where the
  // limit is not the face width but the point at which neighbouring blends run
  // into each other.
  it('accounts for fillets that would collide with each other', () => {
    const solid = plate()
    const corners = verticalEdgeReferences(solid)
    expect(corners).toHaveLength(4)

    // 12 mm rounds on all four corners of a 20 mm plate must overlap.
    const result = applyFilletGroup(solid, [filletOperation(corners, 12)])
    expect(result.shape).toBe(solid)
    expect(result.unresolved).toHaveLength(1)

    const recommended = Number(result.unresolved[0].message.match(/about ([\d.]+) mm/)![1])
    // Half the plate is where the four blends meet.
    expect(recommended).toBeLessThanOrEqual(10)

    const retry = applyFilletGroup(solid, [filletOperation(corners, recommended)])
    expect(retry.unresolved).toEqual([])
    retry.shape.delete()
    solid.delete()
  }, 120_000)

  it('reports a fillet whose edge is not on the solid at all', () => {
    const solid = plate()
    const elsewhere: FilletEdgeReference = {
      start: [500, 500, 0],
      end: [500, 500, THICKNESS],
      point: [500, 500, THICKNESS / 2],
    }
    const result = applyFilletGroup(solid, [filletOperation([elsewhere], 2)])

    expect(result.shape).toBe(solid)
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].message).toContain('could not find the edge')
    expect(result.unresolved[0]).toMatchObject({
      code: 'unresolved-edge', subject: { kind: 'edge' },
      repairs: [expect.objectContaining({ kind: 'reselect-edge' })],
    })
    solid.delete()
  }, 120_000)
})
