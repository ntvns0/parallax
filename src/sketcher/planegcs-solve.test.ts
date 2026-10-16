import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs'
import { arcEndPoint, arcStartPoint, normalizeArc } from '../core/arc-geometry'
import type { ArcEntity, LineEntity, PointEntity, SketchConstraint, Vec2 } from '../core/model'
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

describe('point and symmetry constraints in PlaneGCS', () => {
  it('places a D-flat by its distance from the bore centre', () => {
    // The intent A4 needs: the flat 1.2 from the centre, whatever the chord.
    const { entities, constraints } = dProfile(3)
    const placed = constraints.filter((constraint) => constraint.id !== 'chord')
    placed.push({ id: 'offset', type: 'pointLineDistance', entityIds: ['arc', 'flat'], pointRefs: ['center'], value: 1.2 })
    const response = solveWithPlaneGcs(wrapper, { id: 1, entities, constraints: placed, anchor: { entityId: 'arc', point: 'center' } })
    const [arc, flat] = response.entities as [ArcEntity, LineEntity]

    expect(response.converged).toBe(true)
    expect(response.unsupported).toEqual([])
    expect(flat.start[0]).toBeCloseTo(1.2, 7)
    expect(distance(arcEndPoint(arc), flat.start)).toBeLessThan(1e-7)
  })

  it('mirrors one line onto another across a centreline', () => {
    const left: LineEntity = { id: 'left', type: 'line', start: [-5, 0], end: [-5, 9], construction: false }
    const right: LineEntity = { id: 'right', type: 'line', start: [6, 1], end: [7, 8], construction: false }
    const axis: LineEntity = { id: 'axis', type: 'line', start: [0, -5], end: [0, 20], construction: true }
    const constraints: SketchConstraint[] = [
      { id: 'axisV', type: 'vertical', entityIds: ['axis'] },
      { id: 'leftV', type: 'vertical', entityIds: ['left'] },
      { id: 'leftLength', type: 'distance', entityIds: ['left'], value: 9 },
      { id: 'mirrorStart', type: 'symmetric', entityIds: ['left', 'right', 'axis'], pointRefs: ['start', 'start'] },
      { id: 'mirrorEnd', type: 'symmetric', entityIds: ['left', 'right', 'axis'], pointRefs: ['end', 'end'] },
    ]
    const response = solveWithPlaneGcs(wrapper, { id: 1, entities: [left, right, axis], constraints, anchor: { entityId: 'axis', point: 'start' } })
    const [solvedLeft, solvedRight] = response.entities as LineEntity[]

    expect(response.converged).toBe(true)
    expect(solvedRight.start[0]).toBeCloseTo(-solvedLeft.start[0], 7)
    expect(solvedRight.start[1]).toBeCloseTo(solvedLeft.start[1], 7)
    expect(solvedRight.end[0]).toBeCloseTo(-solvedLeft.end[0], 7)
  })

  it('holds a line’s end on a circle', () => {
    const spoke: LineEntity = { id: 'spoke', type: 'line', start: [0, 0], end: [4, 1], construction: false }
    const constraints: SketchConstraint[] = [
      { id: 'radius', type: 'radius', entityIds: ['ring'], value: 5 },
      { id: 'onRing', type: 'pointOnCircle', entityIds: ['spoke', 'ring'], pointRefs: ['end'] },
    ]
    const response = solveWithPlaneGcs(wrapper, {
      id: 1,
      entities: [spoke, { id: 'ring', type: 'circle', center: [0, 0], radius: 5, construction: false }],
      constraints,
      anchor: { entityId: 'ring', point: 'center' },
    })
    const solved = response.entities[0] as LineEntity
    expect(response.converged).toBe(true)
    expect(Math.hypot(...solved.end)).toBeCloseTo(5, 7)
  })

  it('places a lone point by its distances from two edges, and moves it when they change', () => {
    // A hole position: 8 from the bottom edge and 12 from the left one.
    const bottom: LineEntity = { id: 'bottom', type: 'line', start: [0, 0], end: [40, 0], construction: false }
    const left: LineEntity = { id: 'left', type: 'line', start: [0, 0], end: [0, 30], construction: false }
    const hole: PointEntity = { id: 'hole', type: 'point', position: [10, 10], construction: false }
    const constraints = (fromBottom: number): SketchConstraint[] => [
      { id: 'h', type: 'horizontal', entityIds: ['bottom'] },
      { id: 'v', type: 'vertical', entityIds: ['left'] },
      { id: 'corner', type: 'coincident', entityIds: ['bottom', 'left'], pointRefs: ['start', 'start'] },
      { id: 'up', type: 'pointLineDistance', entityIds: ['hole', 'bottom'], pointRefs: ['center'], value: fromBottom },
      { id: 'across', type: 'pointLineDistance', entityIds: ['hole', 'left'], pointRefs: ['center'], value: 12 },
    ]
    const solve = (fromBottom: number) => solveWithPlaneGcs(wrapper, {
      id: 1, entities: [bottom, left, hole], constraints: constraints(fromBottom), anchor: { entityId: 'bottom', point: 'start' },
    })

    const placed = solve(8)
    expect(placed.converged).toBe(true)
    expect((placed.entities[2] as PointEntity).position[0]).toBeCloseTo(12, 7)
    expect((placed.entities[2] as PointEntity).position[1]).toBeCloseTo(8, 7)
    expect((solve(15).entities[2] as PointEntity).position[1]).toBeCloseTo(15, 7)
  })

  it('anchors a sketch on a lone point and joins a circle’s centre to it', () => {
    const datum: PointEntity = { id: 'datum', type: 'point', position: [5, 5], construction: false }
    const response = solveWithPlaneGcs(wrapper, {
      id: 1,
      entities: [datum, { id: 'ring', type: 'circle', center: [6, 4], radius: 2, construction: false }],
      constraints: [{ id: 'join', type: 'coincident', entityIds: ['datum', 'ring'], pointRefs: ['center', 'center'] }],
      anchor: { entityId: 'datum', point: 'center' },
    })
    expect(response.converged).toBe(true)
    expect((response.entities[0] as PointEntity).position).toEqual([5, 5])
    expect(response.entities[1]).toMatchObject({ center: [expect.closeTo(5, 7), expect.closeTo(5, 7)] })
  })
})
