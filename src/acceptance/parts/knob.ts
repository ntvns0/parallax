import { normalizeArc } from '../../core/arc-geometry'
import { anchorEdgeReferences } from '../../core/edge-anchor'
import { createEmptyDocument, createId, type CadDocument, type ExtrudeFeature, type FilletFeature, type PatternFeature, type RevolveFeature, type SketchFeature } from '../../core/model'
import { defaultPatternParameters } from '../../core/pattern'
import { closedPolyline, drivenLength, feature, parameter, settle } from '../harness'

/**
 * A4 — parametric knob.
 *
 * The body revolved about a construction centreline, a blind D-shaft bore
 * with a clearance allowance, grip grooves round the rim in a circular
 * pattern, and a chamfered top edge. The grooves stop short of the top, so
 * the chamfered rim stays one whole circle.
 *
 * The flat is placed the way a shaft is specified: by its distance from the
 * bore centre, a centre-to-line dimension.
 */

const BORE_RADIUS = '(shaft + clearance) / 2'
const FLAT_OFFSET = `(flat + clearance / 2 - ${BORE_RADIUS})`

export function buildKnob(): CadDocument {
  const radius = 15
  const height = 12

  // The half-section, revolved about a centreline drawn up its inside edge.
  // On XZ the centreline is world Z.
  const section = closedPolyline('section', [[0, 0], [radius, 0], [radius, height], [0, height]])
  const [floor, rim, top] = section.ids
  const centreline = { id: 'knob-axis', type: 'line' as const, start: [0, 0] as [number, number], end: [0, height + 4] as [number, number], construction: true }
  const body = feature<SketchFeature>({
    id: 'knob-section', kind: 'sketch', name: 'Knob section', plane: 'XZ', parameters: { planeOffset: 0 },
    entities: [...section.entities, centreline],
    constraints: [
      ...section.constraints,
      drivenLength(floor, radius, 'knob_radius'),
      drivenLength(rim, height, 'knob_height'),
      { id: createId(), type: 'vertical', entityIds: [centreline.id] },
      { id: createId(), type: 'coincident', entityIds: [centreline.id, floor], pointRefs: ['start', 'start'] },
    ],
    anchor: { entityId: floor, point: 'start' },
  })
  void top
  const revolve = feature<RevolveFeature>({
    id: 'knob-body', kind: 'revolve', name: 'Knob body', sketchId: body.id, operation: 'newBody',
    parameters: { angle: 360, axis: 'Y' }, axisEntityId: centreline.id,
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
      { id: createId(), type: 'pointLineDistance', entityIds: [arc.id, flatLine.id], pointRefs: ['center'], value: d, formula: FLAT_OFFSET },
    ],
    anchor: { entityId: arc.id, point: 'center' },
  })
  const boreCut = feature<ExtrudeFeature>({
    id: 'bore-cut', kind: 'extrude', name: 'Bore', sketchId: bore.id, operation: 'cut',
    parameters: { distance: 10, symmetric: false, edgeRadius: 0 }, formulas: { distance: 'bore_depth' },
  })

  // One groove: a circle centred on the rim, its centre at the end of a
  // construction line as long as the knob's radius, cut up from the bottom.
  const reach = { id: 'groove-reach', type: 'line' as const, start: [0, 0] as [number, number], end: [radius, 0] as [number, number], construction: true }
  const groove = { id: 'groove', type: 'circle' as const, center: [radius, 0] as [number, number], radius: 1, construction: false }
  const grooveSketch = feature<SketchFeature>({
    id: 'groove-sketch', kind: 'sketch', name: 'Groove', plane: 'XY', parameters: { planeOffset: 0 },
    entities: [reach, groove],
    constraints: [
      { id: createId(), type: 'horizontal', entityIds: [reach.id] },
      drivenLength(reach.id, radius, 'knob_radius'),
      { id: createId(), type: 'coincident', entityIds: [reach.id, groove.id], pointRefs: ['end', 'center'] },
      { id: createId(), type: 'radius', entityIds: [groove.id], value: 1, formula: 'groove_radius' },
    ],
    anchor: { entityId: reach.id, point: 'start' },
  })
  const grooveCut = feature<ExtrudeFeature>({
    id: 'groove-cut', kind: 'extrude', name: 'Groove', sketchId: grooveSketch.id, operation: 'cut',
    parameters: { distance: 9, symmetric: false, edgeRadius: 0 }, formulas: { distance: 'knob_height - 3' },
  })
  const grooves = feature<PatternFeature>({
    id: 'grooves', kind: 'pattern', name: 'Grooves', featureIds: [grooveCut.id],
    parameters: { ...defaultPatternParameters('circular'), count: 24 }, formulas: { count: 'grooves' },
  })

  // The top rim, swept round the axis by the section's top outside corner. It
  // is anchored to that corner, so it follows the knob's radius and height.
  const topChamfer = feature<FilletFeature>({
    id: 'knob-top-chamfer', kind: 'fillet', name: 'Top chamfer',
    parameters: { radius: 1, blend: 'chamfer', cornerStyle: 'spherical', filletShape: 'rational' }, formulas: { radius: 'top_chamfer' },
    edges: anchorEdgeReferences([{ start: [radius, 0, height], end: [radius, 0, height], point: [-radius, 0, height] }], [body, revolve]),
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
      parameter('top_chamfer', '1'),
      parameter('grooves', '24'),
      parameter('groove_radius', '1'),
    ],
    features: [body, revolve, bore, boreCut, grooveSketch, grooveCut, grooves, topChamfer],
  })
}

/**
 * The area a groove takes out of the knob's outline: where a circle of radius
 * g centred on the rim overlaps the disc of radius R. The usual lens of two
 * circles, with their centres R apart.
 */
export function grooveArea(R: number, g: number) {
  const d = R
  return g * g * Math.acos((d * d + g * g - R * R) / (2 * d * g))
    + R * R * Math.acos((d * d + R * R - g * g) / (2 * d * R))
    - 0.5 * Math.sqrt((-d + g + R) * (d + g - R) * (d - g + R) * (d + g + R))
}

/**
 * Volume by hand: the cylinder, less the D-bore's area times its depth, less
 * the grooves, each its lens of area times its height, less the chamfer. The D is the bore circle less the segment beyond the flat, and
 * that segment's area is r²·acos(d/r) − d·√(r² − d²). The chamfer is a c × c
 * right triangle swept round the axis; by Pappus that is its area times the
 * circumference at its centroid, c/3 in from the rim.
 */
export function knobVolume(p: { radius: number; height: number; shaft: number; flat: number; clearance: number; depth: number; c: number; grooves: number; g: number }) {
  const r = (p.shaft + p.clearance) / 2
  const d = p.flat + p.clearance / 2 - r
  const segment = r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d)
  const chamfer = (p.c * p.c / 2) * 2 * Math.PI * (p.radius - p.c / 3)
  const grooves = p.grooves * grooveArea(p.radius, p.g) * (p.height - 3)
  return Math.PI * p.radius * p.radius * p.height - (Math.PI * r * r - segment) * p.depth - grooves - chamfer
}
