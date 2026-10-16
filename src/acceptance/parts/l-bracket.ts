import { anchorEdgeReferences } from '../../core/edge-anchor'
import { applyHolePreset, defaultHoleParameters, holeVolume } from '../../core/hole'
import { createEmptyDocument, type CadDocument, type ExtrudeFeature, type FilletFeature, type HoleFeature, type HoleParameters, type PatternFeature, type SketchFeature } from '../../core/model'
import { defaultPatternParameters } from '../../core/pattern'
import { closedPolyline, drivenLength, feature, parameter, settle } from '../harness'

/**
 * A1 — screw-mount L-bracket.
 *
 * The L-shaped body, its inside fillet, a chamfer on the three outside edges,
 * and countersunk M4 holes in each leg, sunk from the inside of the L where
 * the screw heads sit. How many holes each leg has is one parameter.
 *
 * The profile is drawn on XZ, so the base runs along X, the upright along Z,
 * and the width extrudes along -Y.
 */
/** Countersunk for an M4 flat head, through the leg. */
export const M4_COUNTERSUNK: HoleParameters = { ...applyHolePreset(defaultHoleParameters(), 'M4 countersink'), through: true }

export function buildLBracket(): CadDocument {
  const t = 4
  const length = 50
  const height = 30
  // Counter-clockwise from the outside corner: bottom, base end, top of base,
  // inside face of upright, top of upright, outside face.
  const profile = closedPolyline('profile', [[0, 0], [length, 0], [length, t], [t, t], [t, height], [0, height]])
  const [bottom, baseEnd, , , uprightTop, outside] = profile.ids

  const sketch = feature<SketchFeature>({
    id: 'bracket-sketch', kind: 'sketch', name: 'Bracket profile', plane: 'XZ', parameters: { planeOffset: 0 },
    entities: profile.entities,
    constraints: [
      ...profile.constraints,
      drivenLength(bottom, length, 'base_length'),
      drivenLength(baseEnd, t, 'thickness'),
      drivenLength(uprightTop, t, 'thickness'),
      drivenLength(outside, height, 'upright_height'),
    ],
    anchor: { entityId: bottom, point: 'start' },
  })
  const body = feature<ExtrudeFeature>({
    id: 'bracket-body', kind: 'extrude', name: 'Bracket body', sketchId: sketch.id, operation: 'newBody',
    parameters: { distance: 40, symmetric: false, edgeRadius: 0 }, formulas: { distance: 'width' },
  })
  // The inside corner, picked where the top of the base meets the upright and
  // anchored to that sketch corner, so it follows a change of thickness.
  const fillet = feature<FilletFeature>({
    id: 'bracket-inside-fillet', kind: 'fillet', name: 'Inside fillet',
    parameters: { radius: 4, cornerStyle: 'spherical', filletShape: 'rational' }, formulas: { radius: 'inside_radius' },
    edges: [],
  })
  fillet.edges = anchorEdgeReferences([{ start: [t, 0, t], end: [t, -40, t], point: [t, -20, t] }], [sketch, body])
  // The outside edges that a hand would catch on: the heel, the end of the
  // base, and the top of the upright, each anchored to its sketch corner.
  const outsideCorners: [number, number][] = [[0, 0], [length, 0], [0, height]]
  const chamfer = feature<FilletFeature>({
    id: 'bracket-outside-chamfer', kind: 'fillet', name: 'Outside chamfer',
    parameters: { radius: 1, blend: 'chamfer', cornerStyle: 'spherical', filletShape: 'rational' }, formulas: { radius: 'outside_chamfer' },
    edges: anchorEdgeReferences(outsideCorners.map(([x, z]) => ({ start: [x, 0, z], end: [x, -40, z], point: [x, -20, z] })), [sketch, body]),
  })

  // Each leg's first hole is a point on a sketch lying on that leg's inside
  // face, the plane held there by the thickness formula. The base's face is
  // XY at z = t; the upright's is YZ at x = t, where sketch (u, v) is world
  // (y, z). Both drill against their plane's normal, through the leg.
  //
  // Across the width, n holes sit at the middles of n equal shares of it. A
  // construction ruler runs the width, and the first point is held on it half
  // a share from its start; a linear pattern steps the rest along -Y.
  const holeSketch = (id: string, name: string, plane: 'XY' | 'YZ', start: [number, number], end: [number, number]) => {
    const ruler = { id: `${id}-ruler`, type: 'line' as const, start, end, construction: true }
    const pointId = `${id}-first`
    const first = { id: pointId, type: 'point' as const, position: [start[0] + (end[0] - start[0]) / 4, start[1] + (end[1] - start[1]) / 4] as [number, number], construction: false }
    return feature<SketchFeature>({
      id, kind: 'sketch', name, plane, parameters: { planeOffset: t }, formulas: { planeOffset: 'thickness' },
      entities: [ruler, first],
      constraints: [
        { id: `${id}-straight`, type: start[0] === end[0] ? 'vertical' : 'horizontal', entityIds: [ruler.id] },
        drivenLength(ruler.id, 40, 'width'),
        { id: `${pointId}-on`, type: 'pointOnLine', entityIds: [pointId, ruler.id], pointRefs: ['center'] },
        { id: `${pointId}-at`, type: 'pointDistance', entityIds: [pointId, ruler.id], pointRefs: ['center', 'start'], value: 10, formula: 'width / (2 * holes_per_leg)' },
      ],
      anchor: { entityId: ruler.id, point: 'start' },
    })
  }
  // The width runs along -Y from the sketch plane, so each ruler runs that way.
  const baseHoles = holeSketch('base-holes', 'Base hole positions', 'XY', [30, 0], [30, -40])
  const uprightHoles = holeSketch('upright-holes', 'Upright hole positions', 'YZ', [0, 18], [-40, 18])
  const holes = (id: string, sketchId: string) => feature<HoleFeature>({
    id, kind: 'hole', name: id, sketchId, parameters: M4_COUNTERSUNK,
  })
  const baseHole = holes('Base hole', baseHoles.id)
  const uprightHole = holes('Upright hole', uprightHoles.id)
  const rows = feature<PatternFeature>({
    id: 'hole-rows', kind: 'pattern', name: 'Hole rows', featureIds: [baseHole.id, uprightHole.id],
    parameters: { ...defaultPatternParameters('linear'), count: 2, spacing: -20, direction: 'Y' },
    formulas: { count: 'holes_per_leg', spacing: '-width / holes_per_leg' },
  })

  return settle({
    ...createEmptyDocument(),
    id: 'acceptance-l-bracket',
    name: 'A1 L-bracket',
    parameters: [
      parameter('thickness', '4'),
      parameter('base_length', '50'),
      parameter('upright_height', '30'),
      parameter('width', '40'),
      parameter('inside_radius', '4'),
      parameter('outside_chamfer', '1'),
      parameter('holes_per_leg', '2'),
    ],
    features: [sketch, body, fillet, chamfer, baseHoles, baseHole, uprightHoles, uprightHole, rows],
  })
}

/**
 * Volume by hand: the L's cross-section is the base (length × t) plus the
 * upright above it ((height - t) × t), plus what the inside fillet adds — the
 * r × r square less its quarter circle — less a c × c right triangle at each
 * of the three chamfered corners, all times the width. Then less n
 * countersunk holes in each leg, each through the thickness: see `holeVolume`.
 */
export function lBracketVolume(p: { t: number; length: number; height: number; width: number; r: number; c: number; n: number }) {
  const section = p.length * p.t + (p.height - p.t) * p.t + (p.r * p.r - Math.PI * p.r * p.r / 4) - 3 * p.c * p.c / 2
  return section * p.width - 2 * p.n * holeVolume(M4_COUNTERSUNK, p.t)
}
