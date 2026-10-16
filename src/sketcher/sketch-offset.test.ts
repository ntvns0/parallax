import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs'
import { arcEndPoint, arcStartPoint, normalizeArc } from '../core/arc-geometry'
import { getProfileRegions } from '../core/sketch'
import { createFeature, type ArcEntity, type LineEntity, type SketchConstraint, type SketchEntity, type SketchFeature, type Vec2 } from '../core/model'
import { solveWithPlaneGcs } from './planegcs-solve'
import { offsetSketchEntities, withoutRedundantConstraints } from './sketch-offset'

const WASM = resolve(process.cwd(), 'node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')
let wrapper: GcsWrapper

beforeAll(async () => {
  const init = init_planegcs_module as unknown as (config: { locateFile: () => string; wasmBinary: Buffer }) => ReturnType<typeof init_planegcs_module>
  const module = await init({ locateFile: () => WASM, wasmBinary: readFileSync(WASM) })
  wrapper = new GcsWrapper(new module.GcsSystem(), module)
}, 60_000)

const line = (id: string, start: Vec2, end: Vec2): LineEntity => ({ id, type: 'line', start, end, construction: false })
const arc = (id: string, center: Vec2, radius: number, from: number, to: number): ArcEntity =>
  ({ id, type: 'arc', ...normalizeArc(center, radius, from, to), construction: false })

/** A 20 × 10 rectangle, counter-clockwise, its corners joined. */
function rectangle() {
  const corners: Vec2[] = [[0, 0], [20, 0], [20, 10], [0, 10]]
  const entities = corners.map((corner, index) => line(`r${index}`, corner, corners[(index + 1) % 4]))
  const constraints: SketchConstraint[] = entities.map((entity, index) => ({
    id: `j${index}`, type: 'coincident', entityIds: [entity.id, entities[(index + 1) % 4].id], pointRefs: ['end', 'start'],
  }))
  return { entities: entities as SketchEntity[], constraints }
}

/** A slot: two straight sides and two half-circle ends of radius 3, all meeting smoothly. */
function slot() {
  const entities: SketchEntity[] = [
    line('bottom', [0, -3], [10, -3]),
    arc('right', [10, 0], 3, -Math.PI / 2, Math.PI / 2),
    line('top', [10, 3], [0, 3]),
    arc('left', [0, 0], 3, Math.PI / 2, 3 * Math.PI / 2),
  ]
  const constraints: SketchConstraint[] = [
    { id: 'a', type: 'coincident', entityIds: ['bottom', 'right'], pointRefs: ['end', 'start'] },
    { id: 'b', type: 'coincident', entityIds: ['right', 'top'], pointRefs: ['end', 'start'] },
    { id: 'c', type: 'coincident', entityIds: ['top', 'left'], pointRefs: ['end', 'start'] },
    { id: 'd', type: 'coincident', entityIds: ['left', 'bottom'], pointRefs: ['end', 'start'] },
  ]
  return { entities, constraints }
}

/** Solve as the sketcher applies an offset: again and again, without what the joins already fix, until clean. */
function solveOffset(entities: SketchEntity[], existing: SketchConstraint[], added: SketchConstraint[], anchorId: string) {
  let kept = added
  for (let round = 0; round < 3; round += 1) {
    const probe = solveWithPlaneGcs(wrapper, { id: 1, entities, constraints: [...existing, ...kept], anchor: { entityId: anchorId, point: 'start' } })
    const next = withoutRedundantConstraints(kept, probe.redundant)
    if (next.length === kept.length) break
    kept = next
  }
  return solveClean(entities, [...existing, ...kept], anchorId)
}

function solveClean(entities: SketchEntity[], constraints: SketchConstraint[], anchorId: string) {
  const response = solveWithPlaneGcs(wrapper, { id: 1, entities, constraints, anchor: { entityId: anchorId, point: 'start' } })
  expect(response.converged).toBe(true)
  expect(response.conflicting).toEqual([])
  expect(response.redundant.map((id) => constraints.find((constraint) => constraint.id === id)).map((constraint) => `${constraint?.type}:${constraint?.entityIds.join('+')}`)).toEqual([])
  expect(response.unsupported).toEqual([])
  return response.entities
}

function sketchOf(entities: SketchEntity[]): SketchFeature {
  const sketch = createFeature('sketch', 1) as SketchFeature
  sketch.entities = entities
  return sketch
}

describe('offsetSketchEntities', () => {
  it('grows a rectangle outward with sharp corners, tied to the original', () => {
    const { entities, constraints } = rectangle()
    const result = offsetSketchEntities(entities, entities.map((entity) => entity.id), 2)
    if (!result.ok) throw new Error(result.reason)
    const corners = (result.entities as LineEntity[]).map((entity) => entity.start)
    expect(corners).toEqual([[-2, -2], [22, -2], [22, 12], [-2, 12]])

    solveOffset([...entities, ...result.entities], constraints, result.constraints, 'r0')
    // A frame: the outer outline with the original as its hole.
    expect(getProfileRegions(sketchOf([...entities, ...result.entities]))).toEqual([expect.objectContaining({ holes: [expect.anything()] })])
  })

  it('shrinks a rectangle with a negative distance', () => {
    const { entities } = rectangle()
    const result = offsetSketchEntities(entities, entities.map((entity) => entity.id), -2)
    if (!result.ok) throw new Error(result.reason)
    expect((result.entities as LineEntity[]).map((entity) => entity.start)).toEqual([[2, 2], [18, 2], [18, 8], [2, 8]])
  })

  it('grows a slot by moving its sides and enlarging its ends, joined where they meet smoothly', () => {
    const { entities, constraints } = slot()
    const result = offsetSketchEntities(entities, entities.map((entity) => entity.id), 1)
    if (!result.ok) throw new Error(result.reason)
    const [bottom, right, top] = result.entities as [LineEntity, ArcEntity, LineEntity]
    expect(bottom.start).toEqual([0, -4])
    expect(right.radius).toBe(4)
    expect(arcEndPoint(right)[1]).toBeCloseTo(top.start[1], 9)

    const solved = solveOffset([...entities, ...result.entities], constraints, result.constraints, 'bottom')
    const solvedRight = solved.find((entity) => entity.id === right.id) as ArcEntity
    expect(solvedRight.radius).toBeCloseTo(4, 7)
    expect(arcStartPoint(solvedRight)[1]).toBeCloseTo(-4, 7)
  })

  it('moves an open chain to the left of its walk, meeting at the corner', () => {
    const entities = [line('a', [0, 0], [10, 0]), line('b', [10, 0], [10, 10])] as SketchEntity[]
    const result = offsetSketchEntities(entities, ['a', 'b'], 1)
    if (!result.ok) throw new Error(result.reason)
    expect((result.entities as LineEntity[]).map((entity) => [entity.start, entity.end])).toEqual([[[0, 1], [9, 1]], [[9, 1], [9, 10]]])
  })

  it('offsets a circle about its own centre', () => {
    const circle: SketchEntity = { id: 'c', type: 'circle', center: [4, 4], radius: 5, construction: false }
    const result = offsetSketchEntities([circle], ['c'], 2)
    expect(result.ok && result.entities[0]).toMatchObject({ type: 'circle', center: [4, 4], radius: 7 })
    expect(result.ok && result.constraints.map((constraint) => constraint.type)).toEqual(['concentric', 'radius'])
  })

  it('refuses what cannot be offset, and says why', () => {
    const { entities } = rectangle()
    expect(offsetSketchEntities(entities, entities.map((entity) => entity.id), -6)).toMatchObject({ ok: false, reason: expect.stringMatching(/inside out/) })
    const circle: SketchEntity = { id: 'c', type: 'circle', center: [0, 0], radius: 2, construction: false }
    expect(offsetSketchEntities([circle], ['c'], -3)).toMatchObject({ ok: false, reason: expect.stringMatching(/radius 2/) })
    const branching = [line('a', [0, 0], [5, 0]), line('b', [5, 0], [10, 0]), line('c', [5, 0], [5, 5])] as SketchEntity[]
    expect(offsetSketchEntities(branching, ['a', 'b', 'c'], 1)).toMatchObject({ ok: false, reason: expect.stringMatching(/branch/) })
    expect(offsetSketchEntities(entities, [], 1)).toMatchObject({ ok: false })
    expect(offsetSketchEntities(entities, ['r0'], 0)).toMatchObject({ ok: false })
  })

  it('keeps the copy tied to the original when the original moves', () => {
    // Widen the rectangle to 22 by dimensioning its bottom: the copy follows.
    // The distances are unsigned, as PlaneGCS's are, so a large jump could
    // land the copy on the inside instead; an edit this size cannot.
    const { entities, constraints } = rectangle()
    const result = offsetSketchEntities(entities, entities.map((entity) => entity.id), 2)
    if (!result.ok) throw new Error(result.reason)
    const held: SketchConstraint[] = [
      ...constraints,
      { id: 'h0', type: 'horizontal', entityIds: ['r0'] }, { id: 'v1', type: 'vertical', entityIds: ['r1'] },
      { id: 'h2', type: 'horizontal', entityIds: ['r2'] }, { id: 'v3', type: 'vertical', entityIds: ['r3'] },
      { id: 'w', type: 'distance', entityIds: ['r0'], value: 22 },
    ]
    const solved = solveOffset([...entities, ...result.entities], held, result.constraints, 'r0')
    const outerRight = solved.find((entity) => entity.id === result.entities[1].id) as LineEntity
    expect(outerRight.start[0]).toBeCloseTo(24, 6)
  })
})
