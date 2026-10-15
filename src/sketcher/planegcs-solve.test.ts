import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs'
import { arcEndPoint, arcStartPoint, normalizeArc } from '../core/arc-geometry'
import type { ArcEntity, LineEntity, SketchConstraint, Vec2 } from '../core/model'
import { solveWithPlaneGcs } from './planegcs-solve'

/**
 * The real PlaneGCS, loaded from disk, through the same function the solver
 * worker calls.
 */

const WASM = resolve(process.cwd(), 'node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')
let wrapper: GcsWrapper

beforeAll(async () => {
  const init = init_planegcs_module as unknown as (config: { locateFile: () => string; wasmBinary: Buffer }) => ReturnType<typeof init_planegcs_module>
  const module = await init({ locateFile: () => WASM, wasmBinary: readFileSync(WASM) })
  wrapper = new GcsWrapper(new module.GcsSystem(), module)
}, 60_000)

const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** A D: the long way round a circle of radius 3, closed by a flat at x = 1.5. */
function dProfile(radiusValue: number) {
  const h = Math.sqrt(9 - 2.25)
  const start = Math.atan2(h, 1.5)
  const arc: ArcEntity = { id: 'arc', type: 'arc', ...normalizeArc([0, 0], 3, start, 2 * Math.PI - start), construction: false }
  const flat: LineEntity = { id: 'flat', type: 'line', start: [1.5, -h], end: [1.5, h], construction: false }
  const constraints: SketchConstraint[] = [
    { id: 'radius', type: 'radius', entityIds: ['arc'], value: radiusValue },
    { id: 'vertical', type: 'vertical', entityIds: ['flat'] },
    { id: 'joinBottom', type: 'coincident', entityIds: ['arc', 'flat'], pointRefs: ['end', 'start'] },
    { id: 'joinTop', type: 'coincident', entityIds: ['flat', 'arc'], pointRefs: ['end', 'start'] },
    { id: 'chord', type: 'distance', entityIds: ['flat'], value: 2 * h },
  ]
  return { entities: [arc, flat], constraints }
}

describe('solveWithPlaneGcs', () => {
  it('keeps an arc joined to its neighbours when its radius changes', () => {
    // An arc's end points are separate solver points. Without PlaneGCS's arc
    // rules nothing ties them to the arc's angles, so the points follow the
    // flat while the arc itself keeps its old angles and comes apart.
    const { entities, constraints } = dProfile(2.8)
    const response = solveWithPlaneGcs(wrapper, { id: 1, entities, constraints, anchor: { entityId: 'arc', point: 'center' } })
    const [arc, flat] = response.entities as [ArcEntity, LineEntity]

    expect(response.converged).toBe(true)
    expect(arc.radius).toBeCloseTo(2.8, 9)
    expect(distance(arcEndPoint(arc), flat.start)).toBeLessThan(1e-7)
    expect(distance(flat.end, arcStartPoint(arc))).toBeLessThan(1e-7)
  })

  it('reports the solve as converged when the constraints hold', () => {
    const { entities, constraints } = dProfile(3)
    expect(solveWithPlaneGcs(wrapper, { id: 1, entities, constraints, anchor: { entityId: 'arc', point: 'center' } }).converged).toBe(true)
  })

  it('reports a sketch with no solution as not converged', () => {
    // A 5.2 mm chord cannot fit in a circle 5 mm across.
    const { entities, constraints } = dProfile(2.5)
    expect(solveWithPlaneGcs(wrapper, { id: 1, entities, constraints, anchor: { entityId: 'arc', point: 'center' } }).converged).toBe(false)
  })

  it('names only user constraints as redundant, never the arc rules it adds itself', () => {
    const { entities, constraints } = dProfile(3)
    const doubled = [...constraints, { ...constraints[0], id: 'radiusAgain' }]
    const response = solveWithPlaneGcs(wrapper, { id: 1, entities, constraints: doubled, anchor: { entityId: 'arc', point: 'center' } })
    const named = [...response.redundant, ...response.conflicting]

    expect(named.length).toBeGreaterThan(0)
    expect(named.every((id) => doubled.some((constraint) => constraint.id === id))).toBe(true)
  })
})
