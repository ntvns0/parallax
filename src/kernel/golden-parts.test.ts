import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import { measureVolume, setOC, type Shape3D } from 'replicad'
import {
  createExtrudeFeature,
  createFeature,
  createFilletFeature,
  createHoleFeature,
  createPatternFeature,
  createId,
  createRevolveFeature,
  createShellFeature,
  isSolidFeature,
  type ExtrudeFeature,
  type Feature,
  type FilletEdgeReference,
  type HoleParameters,
  type PatternParameters,
  type RevolveFeature,
  type SketchEntity,
  type SketchFeature,
  type Vec2,
} from '../core/model'
import { normalizeArc } from '../core/arc-geometry'
import { anchorEdgeReferences } from '../core/edge-anchor'
import { holeVolume } from '../core/hole'
import { defaultPatternParameters } from '../core/pattern'
import { faceReference } from '../core/shell'
import { buildOperationChain } from './operation-chain'
import { evaluateOperations } from './evaluate-chain'
import { edgeGeometry } from './fillet-apply'
import { parseStoredDocument } from '../core/document-migration'

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
  const last = [...features].reverse().find(isSolidFeature)
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

/** The edge a revolve sweeps from a profile corner at radius `radius`, height `height` along +Y. */
function rimReference(features: Feature[], radius: number, height: number): FilletEdgeReference {
  return withSolid(features, (shape) => {
    const found = shape.edges.map((edge) => edgeGeometry(edge)).find((geometry) =>
      [geometry.start, geometry.middle].every((point) =>
        Math.abs(point[1] - height) < 1e-6 && Math.abs(Math.hypot(point[0], point[2]) - radius) < 1e-6))
    if (!found) throw new Error(`No rim at radius ${radius}, height ${height}.`)
    return { point: found.middle, start: found.start, end: found.end } as FilletEdgeReference
  })
}

/** The volume of a document's final solid, failing if any reference in it did not resolve. */
function resolvedVolume(features: Feature[]): number {
  const last = features.at(-1) as Extract<Feature, { kind: 'fillet' }>
  const evaluation = evaluateOperations(buildOperationChain(last, features))
  try {
    expect(evaluation.unresolved).toEqual([])
    return measureVolume(evaluation.shape)
  } finally {
    evaluation.release()
  }
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

  it('revolves about a construction centreline away from the sketch origin', () => {
    // The 10..20 section turned about the line x = 5 instead of the Y axis:
    // radii 5..15, 5 mm tall. The centreline is not part of the profile.
    const centreline = { ...line([5, -10], [5, 20]), construction: true }
    const sketch = sketchOf([...rectangle([10, 0], [20, 5]), centreline])
    const revolve = revolveOf(sketch, 360, 'Y')
    revolve.axisEntityId = centreline.id
    const part = inspect([sketch, revolve])

    expect(part.volume).toBeCloseTo(Math.PI * (15 ** 2 - 5 ** 2) * 5, 4)
    expect(part.faces).toBe(4)
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

  describe('shells', () => {
    /** An 80 × 50 × 30 box standing on the XY plane. */
    function box(height = 30): Feature[] {
      const sketch = sketchOf(rectangle([-40, -25], [40, 25]))
      sketch.id = 'box-sketch'
      const extrude = extrudeOf(sketch, height)
      extrude.id = 'box'
      return [sketch, extrude]
    }
    const openTop = (features: Feature[]) => faceReference([5, 5, 30], [0, 0, 1], features)

    it('hollows a box with its top open', () => {
      const base = box()
      const part = inspect([...base, createShellFeature([openTop(base)], 1, 2)])

      // The box less the inside: 76 × 46 across, 28 deep from the open top.
      expect(part.volume).toBeCloseTo(80 * 50 * 30 - 76 * 46 * 28, 4)
      // To 0.01 mm: OpenCascade stamps a shell with a 1e-3 tolerance, which
      // the bounding box is inflated by. See the kernel behaviour notes.
      part.bounds.max.forEach((value, axis) => expect(value).toBeCloseTo([40, 25, 30][axis], 2))
    })

    it('follows the open top when the box gets taller', () => {
      const base = box()
      const shell = createShellFeature([openTop(base)], 1, 2)
      const taller = box(45)

      expect(resolvedVolume([...taller, shell])).toBeCloseTo(80 * 50 * 45 - 76 * 46 * 43, 4)
    })

    it('shells a box with rounded upright corners, the inside rounded at the radius less the wall', () => {
      const base = box()
      const rounded = [...base, createFilletFeature(verticalEdgeReferences(base), 1, 3)]
      const volume = volumeOf([...rounded, createShellFeature([openTop(base)], 1, 2)])

      // A rounded rectangle is its box less (4 − π)r² at the corners. The
      // inside's corners are R1, the outside's R3 moved in by the wall.
      const outer = (80 * 50 - (4 - Math.PI) * 9) * 30
      const inner = (76 * 46 - (4 - Math.PI) * 1) * 28
      expect(volume).toBeCloseTo(outer - inner, 3)
    })

    it('reports the thickest wall that works, and leaves the box whole, when the wall is too thick', () => {
      const base = box()
      const shell = createShellFeature([openTop(base)], 1, 40)
      const evaluation = evaluateOperations(buildOperationChain(shell, [...base, shell]))
      try {
        expect(measureVolume(evaluation.shape)).toBeCloseTo(80 * 50 * 30, 4)
        expect(evaluation.unresolved).toHaveLength(1)
        const [diagnostic] = evaluation.unresolved
        expect(diagnostic.code).toBe('oversized-shell')
        const repair = diagnostic.repairs.find((candidate) => candidate.kind === 'apply-thickness')
        // The box is 50 wide, so a wall must leave room: under 25 mm.
        expect(repair && 'value' in repair && repair.value).toBeGreaterThan(20)
        expect(repair && 'value' in repair && repair.value).toBeLessThan(25)
      } finally {
        evaluation.release()
      }
    })

    it('reports a face that is no longer there', () => {
      const base = box()
      const shell = createShellFeature([{ point: [5, 5, 60], normal: [0, 0, 1] }], 1, 2)
      const evaluation = evaluateOperations(buildOperationChain(shell, [...base, shell]))
      try {
        expect(evaluation.unresolved.map((diagnostic) => diagnostic.code)).toEqual(['unresolved-face'])
        expect(measureVolume(evaluation.shape)).toBeCloseTo(80 * 50 * 30, 4)
      } finally {
        evaluation.release()
      }
    })
  })

  it('chamfers a revolved rim, anchored to the profile corner that swept it', () => {
    // The 10..20 tube section, its outer top corner (20, 5) swept round Y.
    // Picked off the solid, the rim anchors to that corner, and the anchor is
    // what the kernel matches — on a full turn and on a quarter turn, whose
    // rim ends where the turn ends.
    for (const angle of [360, 90]) {
      const sketch = sketchOf(rectangle([10, 0], [20, 5]))
      const base: Feature[] = [sketch, revolveOf(sketch, angle, 'Y')]
      const rim = rimReference(base, 20, 5)
      const [anchored] = anchorEdgeReferences([rim], base)
      expect(anchored.anchor).toMatchObject({ kind: 'profileRevolve' })
      const chamfer = createFilletFeature([anchored], 1, 1, { blend: 'chamfer' })

      // Pappus: a 1 × 1 right triangle, its centroid 1/3 in from radius 20,
      // swept through the revolve's angle.
      expect(resolvedVolume([...base, chamfer])).toBeCloseTo(
        Math.PI * (20 ** 2 - 10 ** 2) * 5 * angle / 360 - 0.5 * (20 - 1 / 3) * angle * Math.PI / 180, 4)

      // Widen the section to 25: the chamfer follows the corner out.
      const [bottom, outside, top] = sketch.entities as Extract<SketchEntity, { type: 'line' }>[]
      bottom.end = [25, 0]
      outside.start = [25, 0]
      outside.end = [25, 5]
      top.start = [25, 5]
      expect(resolvedVolume([...base, chamfer])).toBeCloseTo(
        Math.PI * (25 ** 2 - 10 ** 2) * 5 * angle / 360 - 0.5 * (25 - 1 / 3) * angle * Math.PI / 180, 4)
    }
  })

  it('drills simple, counterbored and countersunk holes at sketch points', () => {
    // A 40 × 30 × 6 plate, and a sketch of three points lying on its top face.
    const base = sketchOf(rectangle([0, 0], [40, 30]), 1)
    const plate: Feature[] = [base, extrudeOf(base, 6)]
    const points = sketchOf([[8, 15], [20, 15], [32, 15]].map(([x, y]) => ({ id: createId(), type: 'point' as const, position: [x, y] as Vec2, construction: false })), 2)
    points.parameters.planeOffset = 6
    const drilled = (parameters: HoleParameters) => volumeOf([...plate, points, createHoleFeature(points.id, 1, parameters)])
    const sizes: HoleParameters = { form: 'simple', diameter: 3.4, depth: 4, through: true, headDiameter: 6.5, headDepth: 3.3, countersinkAngle: 90 }

    // Through all is the full 6 mm, however far "through" reaches past it.
    expect(drilled(sizes)).toBeCloseTo(40 * 30 * 6 - 3 * holeVolume(sizes, 6), 4)
    expect(drilled({ ...sizes, through: false })).toBeCloseTo(40 * 30 * 6 - 3 * holeVolume(sizes, 4), 4)
    expect(drilled({ ...sizes, form: 'counterbore' })).toBeCloseTo(40 * 30 * 6 - 3 * holeVolume({ ...sizes, form: 'counterbore' }, 6), 4)
    expect(drilled({ ...sizes, form: 'countersink' })).toBeCloseTo(40 * 30 * 6 - 3 * holeVolume({ ...sizes, form: 'countersink' }, 6), 4)
  })

  describe('patterns', () => {
    // A 40 × 30 × 6 plate on XY, with something small to copy.
    const plateFeatures = () => {
      const base = sketchOf(rectangle([0, 0], [40, 30]), 1)
      return [base, extrudeOf(base, 6)] as Feature[]
    }
    const pattern = (seedId: string, parameters: Partial<PatternParameters> & Pick<PatternParameters, 'pattern'>) =>
      createPatternFeature([seedId], 1, { ...defaultPatternParameters(parameters.pattern), ...parameters })

    it('repeats a through hole along a row', () => {
      const points = sketchOf([{ id: createId(), type: 'point', position: [5, 15], construction: false }], 2)
      points.parameters.planeOffset = 6
      const sizes: HoleParameters = { form: 'simple', diameter: 4, depth: 6, through: true, headDiameter: 8, headDepth: 2, countersinkAngle: 90 }
      const hole = createHoleFeature(points.id, 1, sizes)
      const volume = volumeOf([...plateFeatures(), points, hole, pattern(hole.id, { pattern: 'linear', count: 4, spacing: 10, direction: 'X' })])
      expect(volume).toBeCloseTo(40 * 30 * 6 - 4 * holeVolume(sizes, 6), 4)
    })

    it('repeats a boss in a grid', () => {
      const bossSketch = sketchOf(rectangle([2, 2], [6, 6]), 2)
      bossSketch.parameters.planeOffset = 6
      const boss = extrudeOf(bossSketch, 3, 'add', 2)
      const volume = volumeOf([...plateFeatures(), bossSketch, boss,
        pattern(boss.id, { pattern: 'linear', count: 3, spacing: 12, direction: 'X', count2: 2, spacing2: 15, direction2: 'Y' })])
      expect(volume).toBeCloseTo(40 * 30 * 6 + 6 * 4 * 4 * 3, 4)
    })

    it('turns a pocket round an axis', () => {
      // A disc of radius 15 and six 2 × 2 × 2 pockets round it at radius 10.
      const disc = sketchOf([circle([0, 0], 15)], 1)
      const pocketSketch = sketchOf(rectangle([9, -1], [11, 1]), 2)
      pocketSketch.parameters.planeOffset = 6
      const pocket = extrudeOf(pocketSketch, -2, 'cut', 2)
      const volume = volumeOf([disc, extrudeOf(disc, 6), pocketSketch, pocket,
        pattern(pocket.id, { pattern: 'circular', count: 6, angle: 360, direction: 'Z', origin: [0, 0, 0] })])
      expect(volume).toBeCloseTo(Math.PI * 225 * 6 - 6 * 8, 4)
    })

    it('mirrors a boss across a plane', () => {
      const base = sketchOf(rectangle([-20, -10], [20, 10]), 1)
      const bossSketch = sketchOf(rectangle([5, -2], [9, 2]), 2)
      bossSketch.parameters.planeOffset = 4
      const boss = extrudeOf(bossSketch, 5, 'add', 2)
      const features = [base, extrudeOf(base, 4), bossSketch, boss, pattern(boss.id, { pattern: 'mirror', direction: 'X', origin: [0, 0, 0] })]
      const part = inspect(features)
      expect(part.volume).toBeCloseTo(40 * 20 * 4 + 2 * 4 * 4 * 5, 4)
      // The copy lands at x = -9..-5, so the bosses sit symmetrically.
      expectPoint(part.bounds.max, [20, 10, 9])
    })
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

  it.each([4, 5, 6, 7, 8])('rebuilds the saved v%i schema fixture', (version) => {
    // The pocketed plate from `core/fixtures`, opened through migration. A
    // 40 x 30 x 6 plate, less a 20 x 12 x 4 pocket, plus what an R2 fillet
    // adds back in one concave corner of that pocket: the square r² less its
    // quarter circle, over the 4 mm depth.
    const raw = readFileSync(resolve(process.cwd(), `src/core/fixtures/schema-v${version}.parallax.json`), 'utf8')
    const document = parseStoredDocument(raw)
    if (!document) throw new Error(`The v${version} fixture did not open.`)

    const part = inspect(document.features)

    expect(part.volume).toBeCloseTo(40 * 30 * 6 - 20 * 12 * 4 + (4 - Math.PI) * 4, 4)
    expectPoint(part.bounds.min.map((value) => Math.round(value * 1000) / 1000), [-20, -15, 0])
    expectPoint(part.bounds.max.map((value) => Math.round(value * 1000) / 1000), [20, 15, 6])
  })
})
