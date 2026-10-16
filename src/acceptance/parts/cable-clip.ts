import { normalizeArc } from '../../core/arc-geometry'
import { applyHolePreset, defaultHoleParameters, holeVolume } from '../../core/hole'
import { createEmptyDocument, createId, type ArcEntity, type CadDocument, type ExtrudeFeature, type HoleFeature, type HoleParameters, type LineEntity, type PatternFeature, type SketchConstraint, type SketchFeature, type Vec2 } from '../../core/model'
import { defaultPatternParameters } from '../../core/pattern'
import { drivenLength, feature, parameter, settle } from '../harness'

/**
 * A2 — desk cable clip.
 *
 * A flat base with a C-shaped channel standing on it, the cable pressed in
 * through a snap opening at the top. The profile is drawn on XZ about a
 * construction centreline up world Z, and extruded along -Y.
 *
 * The channel's inside sits on the base's top face, so the cable rests on
 * the base. Its outside is the inside offset by the wall: concentric, its
 * radius the inner one plus `wall`, which is the intent a sketch offset
 * records. The opening's sides are held half the opening either side of the
 * centreline, and the base is symmetric about it.
 *
 * A countersunk M3 hole sits in the right wing, and a mirror across the
 * centre plane puts its twin in the left.
 */

/** Countersunk for an M3 flat head, through the base. */
export const M3_COUNTERSUNK: HoleParameters = { ...applyHolePreset(defaultHoleParameters(), 'M3 countersink'), through: true }

const INNER = 'channel / 2'
const OUTER = 'channel / 2 + wall'

export function buildCableClip(): CadDocument {
  const length = 40
  const t = 3
  const ri = 5
  const ro = 7
  const a = 3.5
  const centre: Vec2 = [0, t + ri]

  const line = (id: string, start: Vec2, end: Vec2, construction = false): LineEntity => ({ id, type: 'line', start, end, construction })
  const arc = (id: string, radius: number, start: number, end: number): ArcEntity => ({ id, type: 'arc', ...normalizeArc(centre, radius, start, end), construction: false })
  const angleAt = (radius: number, x: number, above: boolean) => Math.atan2((above ? 1 : -1) * Math.sqrt(radius * radius - x * x), x)

  // Where the outside of the channel meets the top of the base, and where the
  // opening's sides cut the two circles.
  const junction = Math.sqrt(ro * ro - ri * ri)
  const outerTop = centre[1] + Math.sqrt(ro * ro - a * a)
  const innerTop = centre[1] + Math.sqrt(ri * ri - a * a)

  // Round the outline counter-clockwise from the bottom of the base. The
  // inside of the channel is passed the other way, from its right lip down
  // round the bottom and up to its left lip, but stored counter-clockwise
  // like every arc, from left lip to right.
  const bottom = line('clip-bottom', [-length / 2, 0], [length / 2, 0])
  const rightEnd = line('clip-right-end', [length / 2, 0], [length / 2, t])
  const rightTop = line('clip-right-top', [length / 2, t], [junction, t])
  const rightOuter = arc('clip-right-outer', ro, angleAt(ro, junction, false), angleAt(ro, a, true))
  const rightLip = line('clip-right-lip', [a, outerTop], [a, innerTop])
  const inner = arc('clip-inner', ri, angleAt(ri, -a, true), angleAt(ri, a, true))
  const leftLip = line('clip-left-lip', [-a, innerTop], [-a, outerTop])
  const leftOuter = arc('clip-left-outer', ro, angleAt(ro, -a, true), angleAt(ro, -junction, false))
  const leftTop = line('clip-left-top', [-junction, t], [-length / 2, t])
  const leftEnd = line('clip-left-end', [-length / 2, t], [-length / 2, 0])
  const centreline = line('clip-centreline', [0, 0], [0, 20], true)

  const join = (first: string, firstRef: 'start' | 'end', second: string, secondRef: 'start' | 'end'): SketchConstraint =>
    ({ id: createId(), type: 'coincident', entityIds: [first, second], pointRefs: [firstRef, secondRef] })
  const of = (type: SketchConstraint['type'], ...entityIds: string[]): SketchConstraint => ({ id: createId(), type, entityIds })

  const profile = feature<SketchFeature>({
    id: 'clip-profile', kind: 'sketch', name: 'Clip profile', plane: 'XZ', parameters: { planeOffset: 0 },
    entities: [bottom, rightEnd, rightTop, rightOuter, rightLip, inner, leftLip, leftOuter, leftTop, leftEnd, centreline],
    constraints: [
      join(bottom.id, 'end', rightEnd.id, 'start'),
      join(rightEnd.id, 'end', rightTop.id, 'start'),
      join(rightTop.id, 'end', rightOuter.id, 'start'),
      join(rightOuter.id, 'end', rightLip.id, 'start'),
      join(rightLip.id, 'end', inner.id, 'end'),
      join(inner.id, 'start', leftLip.id, 'start'),
      join(leftLip.id, 'end', leftOuter.id, 'start'),
      join(leftOuter.id, 'end', leftTop.id, 'start'),
      join(leftTop.id, 'end', leftEnd.id, 'start'),
      join(leftEnd.id, 'end', bottom.id, 'start'),

      // The base: centred on the centreline by symmetry, its bottom through
      // the centreline's foot.
      of('vertical', centreline.id),
      { id: createId(), type: 'distance', entityIds: [centreline.id], value: 20 },
      { id: createId(), type: 'symmetric', entityIds: [bottom.id, bottom.id, centreline.id], pointRefs: ['start', 'end'] },
      { id: createId(), type: 'pointOnLine', entityIds: [centreline.id, bottom.id], pointRefs: ['start'] },
      drivenLength(bottom.id, length, 'base_length'),
      of('vertical', rightEnd.id),
      of('vertical', leftEnd.id),
      drivenLength(rightEnd.id, t, 'base_thickness'),
      drivenLength(leftEnd.id, t, 'base_thickness'),
      of('horizontal', rightTop.id),
      of('horizontal', leftTop.id),

      // The channel: the inside on the centreline and resting on the base,
      // the outside offset from it by the wall.
      { id: createId(), type: 'pointOnLine', entityIds: [inner.id, centreline.id], pointRefs: ['center'] },
      { id: createId(), type: 'pointLineDistance', entityIds: [inner.id, bottom.id], pointRefs: ['center'], value: t + ri, formula: `base_thickness + ${INNER}` },
      { id: createId(), type: 'radius', entityIds: [inner.id], value: ri, formula: INNER },
      of('concentric', rightOuter.id, inner.id),
      of('concentric', leftOuter.id, inner.id),
      { id: createId(), type: 'radius', entityIds: [rightOuter.id], value: ro, formula: OUTER },
      of('equal', leftOuter.id, rightOuter.id),

      // The opening: straight lips, half the opening either side of the centreline.
      of('vertical', rightLip.id),
      of('vertical', leftLip.id),
      { id: createId(), type: 'pointLineDistance', entityIds: [rightLip.id, centreline.id], pointRefs: ['start'], value: a, formula: 'opening / 2' },
      { id: createId(), type: 'pointLineDistance', entityIds: [leftLip.id, rightLip.id], pointRefs: ['end'], value: 2 * a, formula: 'opening' },
    ],
    anchor: { entityId: centreline.id, point: 'start' },
  })
  const body = feature<ExtrudeFeature>({
    id: 'clip-body', kind: 'extrude', name: 'Clip body', sketchId: profile.id, operation: 'newBody',
    parameters: { distance: 15, symmetric: false, edgeRadius: 0 }, formulas: { distance: 'depth' },
  })

  // The hole's point, on the base's top face: halfway along the depth, and
  // out along the wing from the centre plane. Two construction rulers carry
  // those dimensions.
  const across = line('hole-across', [0, 0], [0, -15], true)
  const along = line('hole-along', [0, -7.5], [14, -7.5], true)
  const point = { id: 'hole-point', type: 'point' as const, position: [14, -7.5] as Vec2, construction: false }
  const holeSketch = feature<SketchFeature>({
    id: 'clip-hole-sketch', kind: 'sketch', name: 'Hole position', plane: 'XY',
    parameters: { planeOffset: t }, formulas: { planeOffset: 'base_thickness' },
    entities: [across, along, point],
    constraints: [
      of('vertical', across.id),
      drivenLength(across.id, 15, 'depth'),
      { id: createId(), type: 'midpoint', entityIds: [along.id, across.id], pointRefs: ['start'] },
      of('horizontal', along.id),
      drivenLength(along.id, 14, 'hole_offset'),
      { id: createId(), type: 'coincident', entityIds: [point.id, along.id], pointRefs: ['center', 'end'] },
    ],
    anchor: { entityId: across.id, point: 'start' },
  })
  const hole = feature<HoleFeature>({
    id: 'clip-hole', kind: 'hole', name: 'Screw hole', sketchId: holeSketch.id, parameters: M3_COUNTERSUNK,
  })
  const mirror = feature<PatternFeature>({
    id: 'clip-hole-mirror', kind: 'pattern', name: 'Mirror 1', featureIds: [hole.id],
    parameters: { ...defaultPatternParameters('mirror'), direction: 'X' },
  })

  return settle({
    ...createEmptyDocument(),
    id: 'acceptance-cable-clip',
    name: 'A2 Cable clip',
    parameters: [
      parameter('channel', '10'),
      parameter('wall', '2'),
      parameter('opening', '7'),
      parameter('base_length', '40'),
      parameter('base_thickness', '3'),
      parameter('depth', '15'),
      parameter('hole_offset', '14'),
    ],
    features: [profile, body, holeSketch, hole, mirror],
  })
}

/** The part of a disc of radius r within a over either side of a line through its centre, on one side of the perpendicular line. */
function halfStrip(r: number, a: number) {
  return a * Math.sqrt(r * r - a * a) + r * r * Math.asin(a / r)
}

/**
 * Volume by hand. The section is the base, L × t, plus the channel above it.
 * The channel is the outer disc less the cap the base's top face cuts off its
 * bottom, a chord ri below its centre; less the inner disc, which only
 * touches that face; less the opening, the strip |x| < a of the ring above
 * the centre. Times the depth, less the two countersunk holes through the
 * base: see `holeVolume`.
 */
export function cableClipVolume(p: { length: number; t: number; channel: number; wall: number; opening: number; depth: number }) {
  const ri = p.channel / 2
  const ro = ri + p.wall
  const a = p.opening / 2
  const cap = ro * ro * Math.acos(ri / ro) - ri * Math.sqrt(ro * ro - ri * ri)
  const opening = halfStrip(ro, a) - halfStrip(ri, a)
  const section = p.length * p.t + Math.PI * ro * ro - cap - Math.PI * ri * ri - opening
  return section * p.depth - 2 * holeVolume(M3_COUNTERSUNK, p.t)
}

/** How high the clip stands: the outer circle where the opening's sides cut it. */
export function cableClipHeight(p: { t: number; channel: number; wall: number; opening: number }) {
  const ro = p.channel / 2 + p.wall
  const a = p.opening / 2
  return p.t + p.channel / 2 + Math.sqrt(ro * ro - a * a)
}
