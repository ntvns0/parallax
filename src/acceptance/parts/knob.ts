import { normalizeArc } from '../../core/arc-geometry'
import { createEmptyDocument, createId, type CadDocument, type ExtrudeFeature, type RevolveFeature, type SketchFeature } from '../../core/model'
import { closedPolyline, drivenLength, feature, parameter, settle } from '../harness'

/**
 * A4 — parametric knob.
 *
 * Today: the revolved body and a blind D-shaft bore with a clearance
 * allowance. Waiting on a circular pattern for the grip grooves, chamfer for
 * the top edge, and a construction axis to revolve about.
 *
 * Without a centre-to-line dimension, the flat is placed by the length of its
 * chord: 2·√(r² − d²), where d is how far the flat sits from the bore centre.
 * That is the right geometry but the wrong intent, and it is what Phase 3.2's
 * point-to-line distance replaces.
 */

const BORE_RADIUS = '(shaft + clearance) / 2'
const FLAT_OFFSET = `(flat + clearance / 2 - ${BORE_RADIUS})`
const CHORD = `2 * sqrt((${BORE_RADIUS}) ^ 2 - ${FLAT_OFFSET} ^ 2)`

export function buildKnob(): CadDocument {
  const radius = 15
  const height = 12

  // The half-section revolved about the sketch's vertical axis, which on XZ is
  // world Z.
  const section = closedPolyline('section', [[0, 0], [radius, 0], [radius, height], [0, height]])
  const [floor, rim, top] = section.ids
  const body = feature<SketchFeature>({
    id: 'knob-section', kind: 'sketch', name: 'Knob section', plane: 'XZ', parameters: { planeOffset: 0 },
    entities: section.entities,
    constraints: [
      ...section.constraints,
      drivenLength(floor, radius, 'knob_radius'),
      drivenLength(rim, height, 'knob_height'),
    ],
    anchor: { entityId: floor, point: 'start' },
  })
  void top
  const revolve = feature<RevolveFeature>({
    id: 'knob-body', kind: 'revolve', name: 'Knob body', sketchId: body.id, operation: 'newBody',
    parameters: { angle: 360, axis: 'Y' },
  })

  // The D: the long way round the bore circle, closed by the flat.
  const r = 3.1
  const d = 1.5
  const h = Math.sqrt(r * r - d * d)
  const start = Math.atan2(h, d)
  const arc = { id: 'bore-arc', type: 'arc' as const, ...normalizeArc([0, 0], r, start, 2 * Math.PI - start), construction: false }
  const flatLine = { id: 'bore-flat', type: 'line' as const, start: [d, -h] as [number, number], end: [d, h] as [number, number], construction: false }
  const bore = feature<SketchFeature>({
    id: 'bore-sketch', kind: 'sketch', name: 'D-shaft bore', plane: 'XY', parameters: { planeOffset: 0 },
    entities: [arc, flatLine],
    constraints: [
      { id: createId(), type: 'radius', entityIds: [arc.id], value: r, formula: BORE_RADIUS },
      { id: createId(), type: 'vertical', entityIds: [flatLine.id] },
      { id: createId(), type: 'coincident', entityIds: [arc.id, flatLine.id], pointRefs: ['end', 'start'] },
      { id: createId(), type: 'coincident', entityIds: [flatLine.id, arc.id], pointRefs: ['end', 'start'] },
      drivenLength(flatLine.id, 2 * h, CHORD),
    ],
    anchor: { entityId: arc.id, point: 'center' },
  })
  const boreCut = feature<ExtrudeFeature>({
    id: 'bore-cut', kind: 'extrude', name: 'Bore', sketchId: bore.id, operation: 'cut',
    parameters: { distance: 10, symmetric: false, edgeRadius: 0 }, formulas: { distance: 'bore_depth' },
  })

  return settle({
    ...createEmptyDocument(),
    id: 'acceptance-knob',
    name: 'A4 Knob',
    parameters: [
      parameter('knob_radius', '15'),
      parameter('knob_height', '12'),
      parameter('shaft', '6'),
      parameter('flat', '4.5'),
      parameter('clearance', '0.2'),
      parameter('bore_depth', '10'),
    ],
    features: [body, revolve, bore, boreCut],
  })
}

/**
 * Volume by hand: the cylinder, less the D-bore's area times its depth. The D
 * is the bore circle less the segment beyond the flat, and that segment's
 * area is r²·acos(d/r) − d·√(r² − d²).
 */
export function knobVolume(p: { radius: number; height: number; shaft: number; flat: number; clearance: number; depth: number }) {
  const r = (p.shaft + p.clearance) / 2
  const d = p.flat + p.clearance / 2 - r
  const segment = r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d)
  return Math.PI * p.radius * p.radius * p.height - (Math.PI * r * r - segment) * p.depth
}
