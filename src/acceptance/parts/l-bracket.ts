import { anchorEdgeReferences } from '../../core/edge-anchor'
import { createEmptyDocument, type CadDocument, type ExtrudeFeature, type FilletFeature, type SketchFeature } from '../../core/model'
import { closedPolyline, drivenLength, feature, parameter, settle } from '../harness'

/**
 * A1 — screw-mount L-bracket.
 *
 * Today: the L-shaped body and its inside fillet. Waiting on chamfer for the
 * outside edges, and on the Hole feature and a linear pattern for two
 * countersunk M4 holes per leg.
 *
 * The profile is drawn on XZ, so the base runs along X, the upright along Z,
 * and the width extrudes along -Y.
 */
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
    ],
    features: [sketch, body, fillet],
  })
}

/**
 * Volume by hand: the L's cross-section is the base (length × t) plus the
 * upright above it ((height - t) × t), plus what the inside fillet adds — the
 * r × r square less its quarter circle — all times the width.
 */
export function lBracketVolume(p: { t: number; length: number; height: number; width: number; r: number }) {
  return (p.length * p.t + (p.height - p.t) * p.t + (p.r * p.r - Math.PI * p.r * p.r / 4)) * p.width
}
