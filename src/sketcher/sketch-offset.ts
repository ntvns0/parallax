import { angleAt, arcEndPoint, arcStartPoint, counterClockwiseSpan, normalizeArc } from '../core/arc-geometry'
import { createId, isCurve, type ArcEntity, type CircleEntity, type LineEntity, type SketchConstraint, type SketchEntity, type SketchPointRef, type Vec2 } from '../core/model'
import { extendedIntersections } from './trim'

/**
 * Sketch offset: copy a chain of lines and arcs a fixed distance to one side.
 *
 * The chain is walked end to end. Each line moves sideways and each arc
 * changes radius about the same centre, and where two moved pieces no longer
 * meet — at a sharp corner — both are run on to where they cross. A positive
 * distance goes outward from a closed chain, or to the left of an open one
 * walked from its first piece; a negative one goes the other way.
 *
 * The copy stays tied to the original. Each new line is parallel to the one
 * it came from with its distance dimensioned, each new arc or circle shares
 * its original's centre with its radius dimensioned, and the pieces are joined
 * end to end, so moving the original moves the copy with it.
 */

export type SketchOffsetResult =
  | { ok: true; entities: SketchEntity[]; constraints: SketchConstraint[] }
  | { ok: false; reason: string }

type Segment = LineEntity | ArcEntity
/** One piece of a chain, and whether the walk runs it end to start. */
type Step = { entity: Segment; reversed: boolean }

/** Ends closer than this are one point. Solved sketches agree far more tightly. */
const JOIN_TOLERANCE_MM = 1e-4

const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

function endsOf(entity: Segment): [Vec2, Vec2] {
  return entity.type === 'arc' ? [arcStartPoint(entity), arcEndPoint(entity)] : [entity.start, entity.end]
}

/** Where a step starts and ends, in walking order. */
function walk(step: Step): [Vec2, Vec2] {
  const [start, end] = endsOf(step.entity)
  return step.reversed ? [end, start] : [start, end]
}

/**
 * Order the selected lines and arcs into chains that do not branch. Each
 * chain is open, from a free end, or closed, back to where it began.
 */
function chainsOf(segments: Segment[]): { steps: Step[]; closed: boolean }[] | string {
  const points = segments.flatMap((entity) => endsOf(entity))
  for (const point of points) {
    if (points.filter((other) => distance(point, other) < JOIN_TOLERANCE_MM).length > 2) return 'Offset needs a chain that does not branch: three pieces meet at one point.'
  }
  const unused = new Set(segments)
  const degree = (point: Vec2) => points.filter((other) => distance(point, other) < JOIN_TOLERANCE_MM).length
  const chains: { steps: Step[]; closed: boolean }[] = []
  while (unused.size) {
    // Start from a free end when there is one, so an open chain is walked whole.
    const first = [...unused].find((entity) => endsOf(entity).some((point) => degree(point) === 1)) ?? [...unused][0]
    unused.delete(first)
    const steps: Step[] = [{ entity: first, reversed: degree(endsOf(first)[0]) !== 1 && degree(endsOf(first)[1]) === 1 }]
    for (;;) {
      const tail = walk(steps[steps.length - 1])[1]
      const next = [...unused].find((entity) => endsOf(entity).some((point) => distance(point, tail) < JOIN_TOLERANCE_MM))
      if (!next) break
      unused.delete(next)
      steps.push({ entity: next, reversed: distance(endsOf(next)[1], tail) < JOIN_TOLERANCE_MM })
    }
    const closed = steps.length > 1 && distance(walk(steps[steps.length - 1])[1], walk(steps[0])[0]) < JOIN_TOLERANCE_MM
    chains.push({ steps, closed })
  }
  return chains
}

/** Twice the signed area a closed chain encloses: positive when it is walked counter-clockwise. */
function windingArea(steps: Step[]): number {
  const samples: Vec2[] = []
  for (const step of steps) {
    const { entity } = step
    if (entity.type === 'line') {
      samples.push(walk(step)[0])
      continue
    }
    const count = 16
    for (let index = 0; index < count; index += 1) {
      const t = step.reversed ? 1 - index / count : index / count
      const angle = entity.startAngle + (entity.endAngle - entity.startAngle) * t
      samples.push([entity.center[0] + entity.radius * Math.cos(angle), entity.center[1] + entity.radius * Math.sin(angle)])
    }
  }
  return samples.reduce((sum, point, index) => {
    const next = samples[(index + 1) % samples.length]
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)
}

/** A moved piece, kept in walking order until its corners are settled. */
type Moved =
  | { kind: 'line'; from: Vec2; to: Vec2; source: Step }
  | { kind: 'arc'; center: Vec2; radius: number; from: Vec2; to: Vec2; source: Step }

/** `side` is +1 to move to the left of the walk, -1 to the right. */
function move(step: Step, offset: number, side: number): Moved | string {
  const [from, to] = walk(step)
  const { entity } = step
  if (entity.type === 'line') {
    const length = distance(from, to)
    const normal: Vec2 = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length]
    const shift = offset * side
    return { kind: 'line', from: [from[0] + normal[0] * shift, from[1] + normal[1] * shift], to: [to[0] + normal[0] * shift, to[1] + normal[1] * shift], source: step }
  }
  // Walking an arc counter-clockwise, its centre is on the left.
  const radius = entity.radius + offset * side * (step.reversed ? 1 : -1)
  if (radius <= JOIN_TOLERANCE_MM) return `An offset of ${Math.abs(offset)} is more than an arc of radius ${Math.round(entity.radius * 1000) / 1000} can take.`
  const along = (point: Vec2): Vec2 => {
    const angle = angleAt(entity.center, point)
    return [entity.center[0] + radius * Math.cos(angle), entity.center[1] + radius * Math.sin(angle)]
  }
  return { kind: 'arc', center: entity.center, radius, from: along(from), to: along(to), source: step }
}

function asCurve(piece: Moved): LineEntity | CircleEntity {
  return piece.kind === 'line'
    ? { id: '', type: 'line', start: piece.from, end: piece.to, construction: false }
    : { id: '', type: 'circle', center: piece.center, radius: piece.radius, construction: false }
}

/** The new entity, and which of its ends the walk enters and leaves by. */
function settle(piece: Moved): { entity: Segment; enter: SketchPointRef; leave: SketchPointRef } | string {
  const id = createId()
  if (piece.kind === 'line') {
    const [from, to] = walk(piece.source)
    const before = [to[0] - from[0], to[1] - from[1]]
    const after = [piece.to[0] - piece.from[0], piece.to[1] - piece.from[1]]
    if (before[0] * after[0] + before[1] * after[1] <= 0) return 'The offset is too large for one of the short edges: it would turn inside out.'
    return { entity: { id, type: 'line', start: piece.from, end: piece.to, construction: false }, enter: 'start', leave: 'end' }
  }
  const original = piece.source.entity as ArcEntity
  const forward = !piece.source.reversed
  const [first, last] = forward ? [piece.from, piece.to] : [piece.to, piece.from]
  const arc = normalizeArc(piece.center, piece.radius, angleAt(piece.center, first), angleAt(piece.center, last))
  const sweep = counterClockwiseSpan(arc.startAngle, arc.endAngle)
  if (Math.abs(sweep - (original.endAngle - original.startAngle)) > Math.PI) return 'The offset is too large for one of the arcs: it would turn inside out.'
  return {
    entity: { id, type: 'arc', ...arc, construction: false },
    enter: forward ? 'start' : 'end',
    leave: forward ? 'end' : 'start',
  }
}

function offsetChain(steps: Step[], closed: boolean, offset: number): SketchOffsetResult {
  const side = closed && windingArea(steps) > 0 ? -1 : 1
  const moved: Moved[] = []
  for (const step of steps) {
    const piece = move(step, offset, side)
    if (typeof piece === 'string') return { ok: false, reason: piece }
    moved.push(piece)
  }

  // Close each corner: where the moved pieces still meet, leave them; where
  // they part, run both on to the crossing nearest the original corner.
  const corners = closed ? moved.length : moved.length - 1
  for (let index = 0; index < corners; index += 1) {
    const a = moved[index]
    const b = moved[(index + 1) % moved.length]
    if (distance(a.to, b.from) < JOIN_TOLERANCE_MM) continue
    const corner = walk(a.source)[1]
    const crossing = extendedIntersections(asCurve(a), asCurve(b))
      .sort((p, q) => distance(p, corner) - distance(q, corner))[0]
    if (!crossing) return { ok: false, reason: 'Two neighbouring pieces no longer meet once offset.' }
    a.to = crossing
    b.from = crossing
  }

  const settled = []
  for (const piece of moved) {
    const result = settle(piece)
    if (typeof result === 'string') return { ok: false, reason: result }
    settled.push(result)
  }

  const constraints: SketchConstraint[] = []
  settled.forEach(({ entity }, index) => {
    const original = steps[index].entity
    if (entity.type === 'line') {
      constraints.push(
        { id: createId(), type: 'parallel', entityIds: [entity.id, original.id] },
        { id: createId(), type: 'pointLineDistance', entityIds: [entity.id, original.id], pointRefs: ['start'], value: Math.abs(offset) },
      )
    } else {
      constraints.push(
        { id: createId(), type: 'concentric', entityIds: [entity.id, original.id], pointRefs: ['center', 'center'] },
        { id: createId(), type: 'radius', entityIds: [entity.id], value: entity.radius },
      )
    }
  })
  for (let index = 0; index < corners; index += 1) {
    const a = settled[index]
    const b = settled[(index + 1) % settled.length]
    constraints.push({ id: createId(), type: 'coincident', entityIds: [a.entity.id, b.entity.id], pointRefs: [a.leave, b.enter] })
  }
  return { ok: true, entities: settled.map(({ entity }) => entity), constraints }
}

export function offsetSketchEntities(entities: SketchEntity[], selectedIds: string[], offset: number): SketchOffsetResult {
  if (Math.abs(offset) < JOIN_TOLERANCE_MM) return { ok: false, reason: 'Enter an offset distance other than zero.' }
  const selected = entities.filter((entity) => selectedIds.includes(entity.id)).filter(isCurve)
  if (!selected.length) return { ok: false, reason: 'Select lines, arcs or circles to offset.' }

  const result: { entities: SketchEntity[]; constraints: SketchConstraint[] } = { entities: [], constraints: [] }
  // A circle is its own closed chain: outward is a larger radius.
  for (const circle of selected.filter((entity): entity is CircleEntity => entity.type === 'circle')) {
    const radius = circle.radius + offset
    if (radius <= JOIN_TOLERANCE_MM) return { ok: false, reason: `An offset of ${Math.abs(offset)} is more than a circle of radius ${Math.round(circle.radius * 1000) / 1000} can take.` }
    const copy: CircleEntity = { id: createId(), type: 'circle', center: circle.center, radius, construction: false }
    result.entities.push(copy)
    result.constraints.push(
      { id: createId(), type: 'concentric', entityIds: [copy.id, circle.id], pointRefs: ['center', 'center'] },
      { id: createId(), type: 'radius', entityIds: [copy.id], value: radius },
    )
  }

  const chains = chainsOf(selected.filter((entity): entity is Segment => entity.type !== 'circle'))
  if (typeof chains === 'string') return { ok: false, reason: chains }
  for (const chain of chains) {
    const offsetResult = offsetChain(chain.steps, chain.closed, offset)
    if (!offsetResult.ok) return offsetResult
    result.entities.push(...offsetResult.entities)
    result.constraints.push(...offsetResult.constraints)
  }
  return { ok: true, ...result }
}

/**
 * The offset's constraints, less any the solver found redundant.
 *
 * Where pieces meet smoothly, the joins already fix some of the copy's
 * directions, distances and radii, and which ones depends on the chain: in a
 * slot, the ends' radii and one side's distance settle the other side
 * entirely. Rather than predict that, the caller solves and drops what
 * PlaneGCS names as redundant, until nothing is. A redundant constraint held
 * nothing the rest does not. The joins themselves always stay: they are what
 * keeps the copy one chain.
 */
export function withoutRedundantConstraints(added: SketchConstraint[], redundant: string[]): SketchConstraint[] {
  return added.filter((constraint) => constraint.type === 'coincident' || !redundant.includes(constraint.id))
}
