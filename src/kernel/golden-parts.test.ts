import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import { measureVolume, setOC, type Shape3D } from 'replicad'
import {
  createExtrudeFeature,
  createFeature,
  createFilletFeature,
  createId,
  createRevolveFeature,
  type ExtrudeFeature,
  type Feature,
  type FilletEdgeReference,
  type RevolveFeature,
  type SketchEntity,
  type SketchFeature,
  type Vec2,
} from '../core/model'
import { normalizeArc } from '../core/arc-geometry'
import { buildOperationChain } from './operation-chain'
import { evaluateOperations } from './evaluate-chain'
import { edgeGeometry } from './fillet-apply'

/**
 * Golden parts: whole documents taken through the real kernel and checked
 * against volumes worked out by hand.
 *
 * The pure geometry suites show that a profile closes and that an operation
 * chain is assembled correctly. Neither can show that the solid coming out the
 * far end is the right solid — and that is exactly where the revolve bug lived,
 * invisible to 446 passing tests, because nothing ever asserted what a document
 * actually evaluates to.
 *
 * Volumes here are arithmetic, not observations: each one is derived in a
 * comment from the dimensions of the part. Face and edge counts are OpenCascade
 * representation details rather than geometry, so they are asserted only where
 * the representation is unambiguous.
 *
 * This suite loads the kernel, so it carries a long timeout.
 */

// Resolved from the working directory rather than import.meta.url: the test
// environment is jsdom, where that is not a file URL.
const WASM = resolve(process.cwd(), 'node_modules/replicad-opencascadejs/src/replicad_single.wasm')
const HALF_PI = Math.PI / 2

function line(start: Vec2, end: Vec2): SketchEntity {
  return { id: createId(), type: 'line', start, end, construction: false }
}

function arc(center: Vec2, radius: number, from: number, to: number): SketchEntity {
  const normalized = normalizeArc(center, radius, from, to)
  return { id: createId(), type: 'arc', ...normalized, construction: false }
}

function circle(center: Vec2, radius: number): SketchEntity {
  return { id: createId(), type: 'circle', center, radius, construction: false }
}

/** A closed rectangle, counter-clockwise from its lower-left corner. */
function rectangle(min: Vec2, max: Vec2): SketchEntity[] {
  return [
    line([min[0], min[1]], [max[0], min[1]]),
    line([max[0], min[1]], [max[0], max[1]]),
    line([max[0], max[1]], [min[0], max[1]]),
    line([min[0], max[1]], [min[0], min[1]]),
  ]
}

function sketchOf(entities: SketchEntity[], index = 1): SketchFeature {
  const sketch = createFeature('sketch', index) as SketchFeature
  sketch.entities = entities
  return sketch
}

function extrudeOf(sketch: SketchFeature, distance: number, operation: ExtrudeFeature['operation'] = 'newBody', index = 1): ExtrudeFeature {
  const feature = createExtrudeFeature(sketch.id, index, distance)
  feature.operation = operation
  return feature
}

function revolveOf(sketch: SketchFeature, angle: number, axis: 'X' | 'Y', index = 1): RevolveFeature {
  const feature = createRevolveFeature(sketch.id, index, angle)
  feature.parameters.axis = axis
  return feature
}

/**
 * Evaluate a document and read something off the solid its last feature makes.
 *
 * The solid may be owned by the prefix cache, so it is released through the
 * evaluation rather than deleted directly — see `ChainEvaluation.release`.
 */
function withSolid<T>(features: Feature[], read: (shape: Shape3D) => T): T {
  const last = [...features].reverse().find(
    (feature): feature is ExtrudeFeature | RevolveFeature | Extract<Feature, { kind: 'fillet' }> =>
      feature.kind === 'extrude' || feature.kind === 'revolve' || feature.kind === 'fillet',
  )
  if (!last) throw new Error('The fixture has no solid-producing feature.')
  const evaluation = evaluateOperations(buildOperationChain(last, features))
  try {
    return read(evaluation.shape)
  } finally {
    evaluation.release()
  }
}

function volumeOf(features: Feature[]): number {
  return withSolid(features, (shape) => measureVolume(shape))
}

/**
 * Compare an extent to the millimetre, not to the bit.
 *
 * OpenCascade inflates `Bnd_Box` by the shape's own tolerance, so a plate that
 * genuinely starts at -30 reports -30.0000001. That slack is the bounding box
 * doing its job; asserting on it exactly would test OCCT's tolerance constant
 * rather than the part.
 */
function expectPoint(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 5))
}

/** Volume, face count, and axis-aligned extent, from one evaluation. */
function inspect(features: Feature[]) {
  return withSolid(features, (shape) => {
    const [min, max] = shape.boundingBox.bounds
    return { volume: measureVolume(shape), faces: shape.faces.length, bounds: { min, max } }
  })
}

/**
 * Every vertical edge of a solid, as fillet references.
 *
 * Fillet features name edges by geometry, so a fixture cannot write those
 * coordinates by hand without duplicating the solid it is testing. Reading them
 * off the evaluated shape keeps the fixture describing intent — "round the
 * upright corners" — while the assertion stays a hand-computed volume.
 */
function verticalEdgeReferences(features: Feature[]): FilletEdgeReference[] {
  return withSolid(features, (shape) => shape.edges
    .map((edge) => edgeGeometry(edge))
    .filter((geometry) => Math.abs(geometry.start[2] - geometry.end[2]) > 1e-6
      && Math.hypot(geometry.start[0] - geometry.end[0], geometry.start[1] - geometry.end[1]) < 1e-6)
    .map((geometry) => ({ point: geometry.middle, start: geometry.start, end: geometry.end })))
}

beforeAll(async () => {
  const init = initOpenCascade as unknown as (
    config: { locateFile: () => string; wasmBinary: Buffer },
  ) => Promise<Parameters<typeof setOC>[0]>
  setOC(await init({ locateFile: () => WASM, wasmBinary: readFileSync(WASM) }))
}, 120_000)

describe('golden parts', () => {
  it('extrudes a plain plate', () => {
    const sketch = sketchOf(rectangle([-30, -20], [30, 20]))
    const part = inspect([sketch, extrudeOf(sketch, 8)])

    expect(part.volume).toBeCloseTo(60 * 40 * 8, 6)
    expect(part.faces).toBe(6)
    expectPoint(part.bounds.min, [-30, -20, 0])
    expectPoint(part.bounds.max, [30, 20, 8])
  })

  it('punches a round through hole', () => {
    const sketch = sketchOf([...rectangle([-30, -20], [30, 20]), circle([0, 0], 6)])
    const part = inspect([sketch, extrudeOf(sketch, 8)])

    // 2400 mm² of plate less a Ø12 hole, 8 mm deep.
    expect(part.volume).toBeCloseTo((60 * 40 - Math.PI * 36) * 8, 6)
    // Six planar faces, plus the bore as two half-cylinders. A bore built by
    // boolean comes back split at the seam rather than as one periodic face —
    // unlike the revolved tube below, which keeps its cylinders whole. Pinned
    // because a change here would mean the topology changed, not the tolerance.
    expect(part.faces).toBe(8)
  })

  it('extrudes a profile that mixes straight and curved edges', () => {
    // A slot: 20 x 10 between the centres, capped by a half-round at each end,
    // the two halves making one r5 circle.
    const sketch = sketchOf([
      line([0, 5], [20, 5]),
      arc([20, 0], 5, -HALF_PI, HALF_PI),
      line([20, -5], [0, -5]),
      arc([0, 0], 5, HALF_PI, -HALF_PI),
    ])
    const volume = volumeOf([sketch, extrudeOf(sketch, 10)])

    expect(volume).toBeCloseTo((20 * 10 + Math.PI * 25) * 10, 6)
  })

  it('extrudes symmetrically about the sketch plane', () => {
    const sketch = sketchOf(rectangle([-10, -10], [10, 10]))
    const extrude = extrudeOf(sketch, 12)
    extrude.parameters.symmetric = true
    const part = inspect([sketch, extrude])

    expect(part.volume).toBeCloseTo(20 * 20 * 12, 6)
    expect(part.bounds.min[2]).toBeCloseTo(-6, 6)
    expect(part.bounds.max[2]).toBeCloseTo(6, 6)
  })

  it('revolves a full turn into a tube', () => {
    // A 10 x 5 section standing off the Y axis, swept all the way round it:
    // an annulus with r 10..20, 5 mm tall.
    const sketch = sketchOf(rectangle([10, 0], [20, 5]))
    const part = inspect([sketch, revolveOf(sketch, 360, 'Y')])

    expect(part.volume).toBeCloseTo(Math.PI * (20 ** 2 - 10 ** 2) * 5, 4)
    // Inner and outer cylinders, and the annular caps at each end.
    expect(part.faces).toBe(4)
  })

  it('revolves a partial turn to a proportional volume', () => {
    const sketch = sketchOf(rectangle([10, 0], [20, 5]))
    const volume = volumeOf([sketch, revolveOf(sketch, 90, 'Y')])

    expect(volume).toBeCloseTo(Math.PI * (20 ** 2 - 10 ** 2) * 5 / 4, 4)
  })

  it('adds a boss onto a plate', () => {
    const base = sketchOf(rectangle([-30, -20], [30, 20]), 1)
    const boss = sketchOf(rectangle([-10, -10], [10, 10]), 2)
    boss.parameters.planeOffset = 8
    const volume = volumeOf([base, extrudeOf(base, 8, 'newBody', 1), boss, extrudeOf(boss, 6, 'add', 2)])

    expect(volume).toBeCloseTo(60 * 40 * 8 + 20 * 20 * 6, 6)
  })

  it('cuts a blind pocket into a plate', () => {
    const base = sketchOf(rectangle([-30, -20], [30, 20]), 1)
    const pocket = sketchOf(rectangle([-10, -10], [10, 10]), 2)
    pocket.parameters.planeOffset = 8
    // Cutting back down through the top face.
    const volume = volumeOf([base, extrudeOf(base, 8, 'newBody', 1), pocket, extrudeOf(pocket, -3, 'cut', 2)])

    expect(volume).toBeCloseTo(60 * 40 * 8 - 20 * 20 * 3, 6)
  })

  it('rounds one upright corner', () => {
    const sketch = sketchOf(rectangle([-10, -10], [10, 10]))
    const extrude = extrudeOf(sketch, 10)
    const base: Feature[] = [sketch, extrude]
    const [corner] = verticalEdgeReferences(base)

    const volume = volumeOf([...base, createFilletFeature([corner], 1, 3)])

    // A square corner loses everything outside the quarter-round: r² - πr²/4,
    // over the full 10 mm height.
    expect(volume).toBeCloseTo(20 * 20 * 10 - (9 - Math.PI * 9 / 4) * 10, 5)
  })

  it('rounds all four upright corners as one group', () => {
    const sketch = sketchOf(rectangle([-10, -10], [10, 10]))
    const extrude = extrudeOf(sketch, 10)
    const base: Feature[] = [sketch, extrude]
    const corners = verticalEdgeReferences(base)
    expect(corners).toHaveLength(4)

    const volume = volumeOf([...base, createFilletFeature(corners, 1, 3)])

    expect(volume).toBeCloseTo(20 * 20 * 10 - 4 * (9 - Math.PI * 9 / 4) * 10, 5)
  })

  it('revolves a solid cylinder when the profile meets the axis', () => {
    // The profile touches the axis, so the sweep closes on a degenerate radius
    // rather than leaving a bore. That is the case kernels most often get wrong.
    const sketch = sketchOf(rectangle([0, 0], [10, 20]))
    const part = inspect([sketch, revolveOf(sketch, 360, 'Y')])

    expect(part.volume).toBeCloseTo(Math.PI * 100 * 20, 4)
    expectPoint(part.bounds.min, [-10, 0, -10])
    expectPoint(part.bounds.max, [10, 20, 10])
  })

  it('fuses a box that sits wholly inside a revolved cylinder', () => {
    // A boolean whose answer is known without integrating anything: the box is
    // entirely within the cylinder, so fusing it must change nothing at all.
    // Proves the revolve is a real solid a boolean can consume, not a surface.
    const profile = sketchOf(rectangle([0, 0], [10, 20]), 1)
    const boss = sketchOf(rectangle([-2, 5], [2, 15]), 2)
    const cylinder = Math.PI * 100 * 20

    // Furthest corner of the box from the Y axis is hypot(2, 3) — well inside r10.
    const volume = volumeOf([profile, revolveOf(profile, 360, 'Y', 1), boss, extrudeOf(boss, 3, 'add', 2)])

    expect(volume).toBeCloseTo(cylinder, 4)
  })

  it('keeps an island inside a hole as solid material', () => {
    // Plate, a large bore through it, and a post standing in the middle of the
    // bore. Even-odd nesting means the post is material, not a second hole.
    const sketch = sketchOf([
      ...rectangle([-30, -30], [30, 30]),
      circle([0, 0], 20),
      circle([0, 0], 8),
    ])
    const volume = volumeOf([sketch, extrudeOf(sketch, 5)])

    expect(volume).toBeCloseTo((60 * 60 - Math.PI * 400 + Math.PI * 64) * 5, 5)
  })
})
