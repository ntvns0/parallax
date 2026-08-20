import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import { measureVolume, setOC } from 'replicad'
import {
  createExtrudeFeature,
  createFeature,
  createFilletFeature,
  createId,
  type ExtrudeFeature,
  type Feature,
  type FilletEdgeReference,
  type SketchEntity,
  type SketchFeature,
  type Vec2,
} from '../core/model'
import { buildOperationChain } from './operation-chain'
import { __prefixCache, evaluateOperations } from './evaluate-chain'
import { edgeGeometry } from './fillet-apply'
import type { KernelOperation } from './kernel-types'

/**
 * The prefix cache: resuming a chain from its last unchanged operation.
 *
 * Two things have to hold, and only one of them is about speed. A resumed
 * evaluation must produce exactly the solid a cold one would — including when
 * the chain ends in a run of fillets, which OpenCascade requires be applied as
 * a single group and which therefore may not be split at a cache boundary.
 */

const WASM = resolve(process.cwd(), 'node_modules/replicad-opencascadejs/src/replicad_single.wasm')

function line(start: Vec2, end: Vec2): SketchEntity {
  return { id: createId(), type: 'line', start, end, construction: false }
}

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

function chainOf(features: Feature[]): KernelOperation[] {
  const last = [...features].reverse().find(
    (feature): feature is Extract<Feature, { kind: 'extrude' | 'revolve' | 'fillet' }> =>
      feature.kind === 'extrude' || feature.kind === 'revolve' || feature.kind === 'fillet',
  )
  if (!last) throw new Error('The fixture has no solid-producing feature.')
  return buildOperationChain(last, features)
}

function volumeOf(operations: KernelOperation[]): number {
  const evaluation = evaluateOperations(operations)
  try {
    return measureVolume(evaluation.shape)
  } finally {
    evaluation.release()
  }
}

/** A 40 x 40 x 10 plate whose four upright corners can be rounded. */
function plate() {
  const sketch = sketchOf(rectangle([-20, -20], [20, 20]))
  return [sketch, extrudeOf(sketch, 10)] as Feature[]
}

function verticalEdges(features: Feature[]) {
  const evaluation = evaluateOperations(chainOf(features))
  try {
    return evaluation.shape.edges
      .map((edge) => edgeGeometry(edge))
      .filter((geometry) => Math.abs(geometry.start[2] - geometry.end[2]) > 1e-6
        && Math.hypot(geometry.start[0] - geometry.end[0], geometry.start[1] - geometry.end[1]) < 1e-6)
      .map((geometry) => ({ point: geometry.middle, start: geometry.start, end: geometry.end }))
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

beforeEach(() => __prefixCache.clear())

describe('prefix cache', () => {
  it('serves an identical chain without replaying it', () => {
    const operations = chainOf(plate())

    expect(volumeOf(operations)).toBeCloseTo(40 * 40 * 10, 6)
    const cold = __prefixCache.stats()
    expect(cold.hits).toBe(0)

    expect(volumeOf(operations)).toBeCloseTo(40 * 40 * 10, 6)
    expect(__prefixCache.stats().hits).toBe(1)
  })

  it('resumes from the unchanged head when only the last operation changes', () => {
    const base = plate()
    const pocket = sketchOf(rectangle([-5, -5], [5, 5]), 2)
    pocket.parameters.planeOffset = 10

    const shallow = chainOf([...base, pocket, extrudeOf(pocket, -2, 'cut', 2)])
    expect(volumeOf(shallow)).toBeCloseTo(40 * 40 * 10 - 10 * 10 * 2, 6)

    // Only the cut depth changes, so the plate underneath must be reused.
    const deeper = chainOf([...base, pocket, extrudeOf(pocket, -4, 'cut', 2)])
    const before = __prefixCache.stats().hits
    expect(volumeOf(deeper)).toBeCloseTo(40 * 40 * 10 - 10 * 10 * 4, 6)
    expect(__prefixCache.stats().hits).toBe(before + 1)
  })

  it('does not reuse a prefix when an earlier operation changes', () => {
    const thin = sketchOf(rectangle([-20, -20], [20, 20]))
    expect(volumeOf(chainOf([thin, extrudeOf(thin, 10)]))).toBeCloseTo(40 * 40 * 10, 6)

    const wide = sketchOf(rectangle([-30, -20], [30, 20]))
    expect(volumeOf(chainOf([wide, extrudeOf(wide, 10)]))).toBeCloseTo(60 * 40 * 10, 6)
  })

  it('gives a resumed fillet run exactly the geometry a cold one gets', () => {
    // Four corners rounded together stop at r10, where the blends collide;
    // applied in two groups they would not. This is the case a cache boundary
    // placed inside the run would silently change.
    const base = plate()
    const corners = verticalEdges(base)
    expect(corners).toHaveLength(4)

    const withFillets = [...base, createFilletFeature(corners, 1, 4)]
    const operations = chainOf(withFillets)

    __prefixCache.clear()
    const cold = volumeOf(operations)

    // Warm the plate prefix on its own, then evaluate the filleted chain again:
    // it must resume from that plate and still group all four fillets.
    __prefixCache.clear()
    volumeOf(chainOf(base))
    const resumed = volumeOf(operations)

    expect(resumed).toBeCloseTo(cold, 9)
    expect(resumed).toBeCloseTo(40 * 40 * 10 - 4 * (16 - Math.PI * 16 / 4) * 10, 5)
  })

  it('never cuts a chain in the middle of a fillet run', () => {
    const base = plate()
    const corners = verticalEdges(base)

    // Two fillet features in a row: consecutive, so they form one run.
    const chain = chainOf([
      ...base,
      createFilletFeature([corners[0], corners[1]], 1, 3),
      createFilletFeature([corners[2], corners[3]], 2, 3),
    ])
    expect(chain.filter((operation) => operation.type === 'fillet')).toHaveLength(2)

    __prefixCache.clear()
    const cold = volumeOf(chain)

    __prefixCache.clear()
    volumeOf(chainOf(base))
    const resumed = volumeOf(chain)

    expect(resumed).toBeCloseTo(cold, 9)
    // Whether the boundary between the two fillet features got cached is the
    // point: it must not have, so the deepest reusable prefix is the plate.
    expect(resumed).toBeCloseTo(40 * 40 * 10 - 4 * (9 - Math.PI * 9 / 4) * 10, 5)
  })

  it('reports diagnostics from a prefix it did not replay', () => {
    // A fillet naming an edge that does not exist is skipped with a warning.
    // Once its prefix is cached, that warning has to keep arriving: it is not
    // recoverable from the geometry, which looks the same either way.
    const base = plate()
    const missing: FilletEdgeReference = { point: [999, 999, 999], start: [999, 999, 0], end: [999, 999, 10] }
    const chain = chainOf([...base, createFilletFeature([missing], 1, 3)])

    const cold = evaluateOperations(chain)
    expect(cold.unresolved).toHaveLength(1)
    cold.release()

    const warm = evaluateOperations(chain)
    expect(warm.cached).toBe(true)
    expect(warm.unresolved).toHaveLength(1)
    expect(warm.unresolved[0].code).toBe('unresolved-edge')
    warm.release()
  })

  it('replays one operation when only the last one changed, however long the history', () => {
    // The guarantee the cache exists for, stated as a count rather than a
    // stopwatch: a twenty-feature part edited at its end must not re-run the
    // nineteen operations in front of the edit.
    const base = sketchOf(rectangle([-60, -60], [60, 60]), 1)
    const features: Feature[] = [base, extrudeOf(base, 20, 'newBody', 1)]
    const pockets: ExtrudeFeature[] = []
    for (let index = 0; index < 9; index += 1) {
      const pocket = sketchOf(rectangle([-50 + index * 11, -50], [-44 + index * 11, -44]), index + 2)
      pocket.parameters.planeOffset = 20
      const cut = extrudeOf(pocket, -5, 'cut', index + 2)
      pockets.push(cut)
      features.push(pocket, cut)
    }

    const chain = chainOf(features)
    expect(chain).toHaveLength(10)

    __prefixCache.clear()
    volumeOf(chain)
    expect(__prefixCache.stats().replayed).toBe(10)

    // Deepen only the final pocket, exactly as editing its parameter would.
    pockets.at(-1)!.parameters.distance = -8
    volumeOf(chainOf(features))
    expect(__prefixCache.stats().replayed).toBe(11)
  })

  it('frees evicted shapes without disturbing the result', () => {
    // More distinct chains than the cache holds, evaluated twice each. If
    // eviction freed a shape that was still in use, the second pass would fault
    // or return the wrong volume rather than simply missing the cache.
    const volumes: number[] = []
    for (let depth = 1; depth <= 30; depth += 1) {
      const sketch = sketchOf(rectangle([-10, -10], [10, 10]))
      volumes.push(volumeOf(chainOf([sketch, extrudeOf(sketch, depth)])))
    }
    volumes.forEach((volume, index) => expect(volume).toBeCloseTo(20 * 20 * (index + 1), 6))
    expect(__prefixCache.stats().size).toBeLessThanOrEqual(24)
  })
})
