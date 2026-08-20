import { makeBaseBox, makeProjectedEdges, ProjectionCamera, type Shape3D } from 'replicad'
import {
  arcThroughPoints,
  circleThroughPoints,
  combineBounds,
  curvesBounds,
  dedupeCurves,
  mergeArcsIntoCircles,
  suppressCoveredCurves,
} from '../drawing/curve-geometry'
import type {
  DrawingViewId,
  OrthographicViewId,
  Point2,
  ProjectedCurve,
  ProjectedView,
  SectionRegion,
} from '../drawing/drawing-types'

type Edge = Shape3D['edges'][number]
type Face = Shape3D['faces'][number]
type Vec3 = [number, number, number]

/**
 * Where each standard view is looked at from, in this application's Z-up model
 * space.
 *
 * `direction` points from the part towards the viewer, and `xAxis` is what ends
 * up running left-to-right across the finished view. Both are stated here
 * rather than taken from replicad's named planes because the names there follow
 * a different up-axis convention, and a silently mirrored blueprint is the one
 * defect a shop would not catch.
 *
 * The result is a third-angle set: front looks along +Y, top looks down from
 * +Z with model +Y up the page, and right looks along -X with depth increasing
 * to the right, away from the front view.
 */
const VIEW_CAMERAS: Record<DrawingViewId, { direction: Vec3; xAxis: Vec3 }> = {
  front: { direction: [0, -1, 0], xAxis: [1, 0, 0] },
  top: { direction: [0, 0, 1], xAxis: [1, 0, 0] },
  right: { direction: [1, 0, 0], xAxis: [0, 1, 0] },
  iso: { direction: [1, -1, 1], xAxis: [1, 1, 0] },
  // A section is drawn in the direction of its parent view; the camera is
  // replaced before use.
  section: { direction: [0, -1, 0], xAxis: [1, 0, 0] },
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Which model axis each orthographic view looks along, and which way.
 *
 * `axis` is the index into a model point, and `keepAbove` says which side of
 * the cutting plane survives a section: the material between the plane and the
 * viewer is what gets taken away, so the viewer looks at a freshly cut face.
 */
const VIEW_AXES: Record<OrthographicViewId, { axis: 0 | 1 | 2; keepAbove: boolean }> = {
  front: { axis: 1, keepAbove: true },
  top: { axis: 2, keepAbove: false },
  right: { axis: 0, keepAbove: false },
}

/** Project a model point into a view's own 2D coordinates. */
function toViewPoint(point: Vec3, xAxis: Vec3, yAxis: Vec3): Point2 {
  return [dot(point, xAxis), dot(point, yAxis)]
}

/** Longest chord, in millimetres, used when reducing a free curve to a polyline. */
const POLYLINE_CHORD = 0.4
const MIN_POLYLINE_POINTS = 8
const MAX_POLYLINE_POINTS = 120

/**
 * Read a point off a projected edge in view coordinates.
 *
 * Hidden-line removal returns edges already lying in the projection plane, so
 * the camera's own axes are the returned X and Y and Z is always zero. Dropping
 * it is the projection.
 */
function samplePoint(edge: Edge, t: number): Point2 {
  const vector = edge.pointAt(t)
  try {
    const [x, y] = vector.toTuple()
    return [x, y]
  } finally {
    vector.delete()
  }
}

function polylineFrom(edge: Edge): ProjectedCurve | null {
  const length = edge.length
  const count = Math.min(
    MAX_POLYLINE_POINTS,
    Math.max(MIN_POLYLINE_POINTS, Math.ceil(length / POLYLINE_CHORD) + 1),
  )
  const points = Array.from({ length: count }, (_, index) => samplePoint(edge, index / (count - 1)))
  return points.length >= 2 ? { type: 'polyline', points } : null
}

function curveFromEdge(edge: Edge): ProjectedCurve | null {
  const geomType = edge.geomType

  if (geomType === 'LINE') {
    const start = samplePoint(edge, 0)
    const end = samplePoint(edge, 1)
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-9) return null
    return { type: 'segment', start, end }
  }

  if (geomType === 'CIRCLE') {
    // A closed circular edge has no distinguishable ends, so three interior
    // samples define it; an arc is pinned by its two ends and its midpoint.
    if (edge.isClosed) {
      const circle = circleThroughPoints(samplePoint(edge, 0), samplePoint(edge, 1 / 3), samplePoint(edge, 2 / 3))
      return circle ? { type: 'circle', center: circle.center, radius: circle.radius } : polylineFrom(edge)
    }
    const arc = arcThroughPoints(samplePoint(edge, 0), samplePoint(edge, 0.5), samplePoint(edge, 1))
    return arc ?? polylineFrom(edge)
  }

  return polylineFrom(edge)
}

function convertEdges(edges: Edge[]): ProjectedCurve[] {
  const curves: ProjectedCurve[] = []
  for (const edge of edges) {
    try {
      const curve = curveFromEdge(edge)
      if (curve) curves.push(curve)
    } finally {
      edge.delete()
    }
  }
  return curves
}

/** An axis-aligned box spanning two corners. */
function boxBetween(min: Vec3, max: Vec3): Shape3D {
  const box = makeBaseBox(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  // `makeBaseBox` centres itself in X and Y and rises from z = 0.
  return box.translate([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]]) as Shape3D
}

/**
 * Remove the material between the cutting plane and the viewer.
 *
 * This is what a section view is: not a slice, but the whole part with the near
 * half taken away, so the viewer sees a cut face with the rest of the part
 * still behind it. Cutting a thin slice instead would lose everything beyond
 * the plane and produce a silhouette the part does not have.
 */
function cutAwayNearSide(shape: Shape3D, axis: 0 | 1 | 2, position: number, keepAbove: boolean, bounds: [Vec3, Vec3]): Shape3D {
  const [min, max] = bounds
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1)
  const pad = span * 2 + 10

  const removeMin: Vec3 = [min[0] - pad, min[1] - pad, min[2] - pad]
  const removeMax: Vec3 = [max[0] + pad, max[1] + pad, max[2] + pad]
  if (keepAbove) removeMax[axis] = position
  else removeMin[axis] = position

  const tool = boxBetween(removeMin, removeMax)
  try {
    // The caller still needs the uncut solid for the other views.
    return shape.clone().cut(tool) as Shape3D
  } finally {
    tool.delete()
  }
}

function sampleEdge3d(edge: Edge): Vec3[] {
  const count = edge.geomType === 'LINE'
    ? 2
    : Math.min(MAX_POLYLINE_POINTS, Math.max(MIN_POLYLINE_POINTS, Math.ceil(edge.length / POLYLINE_CHORD) + 1))
  return Array.from({ length: count }, (_, index) => {
    const vector = edge.pointAt(index / (count - 1))
    try {
      return vector.toTuple() as Vec3
    } finally {
      vector.delete()
    }
  })
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Walk a wire into a single closed ring of points.
 *
 * Edges come back in order around the wire but not necessarily pointing the
 * same way round it, so each one is flipped if its far end is closer to where
 * the previous edge finished. Without that the ring folds back on itself and
 * the hatching inside it inverts.
 */
function wireToPolygon(wire: Shape3D['wires'][number], xAxis: Vec3, yAxis: Vec3): Point2[] {
  const ring: Vec3[] = []
  for (const edge of wire.edges) {
    try {
      let samples = sampleEdge3d(edge)
      if (ring.length) {
        const tail = ring[ring.length - 1]
        if (distance3(tail, samples[samples.length - 1]) < distance3(tail, samples[0])) samples = samples.reverse()
        samples = samples.slice(1)
      }
      ring.push(...samples)
    } finally {
      edge.delete()
    }
  }
  // The ring closes implicitly, so drop a repeated final point.
  if (ring.length > 1 && distance3(ring[0], ring[ring.length - 1]) < 1e-9) ring.pop()
  return ring.map((point) => toViewPoint(point, xAxis, yAxis))
}

/**
 * The faces the cutting plane exposed, as hatchable regions.
 *
 * A face qualifies only if it is planar, square to the cut axis and sitting at
 * the cut position — which is precisely the set of faces the boolean just
 * created. Every other face of the solid belongs to the part's own surface and
 * must not be filled in.
 */
function sectionRegions(sectioned: Shape3D, axis: 0 | 1 | 2, position: number, xAxis: Vec3, yAxis: Vec3): SectionRegion[] {
  const regions: SectionRegion[] = []
  for (const face of sectioned.faces as Face[]) {
    try {
      if (face.geomType !== 'PLANE') continue

      const normal = face.normalAt()
      const alignedToCut = Math.abs(Math.abs(normal.toTuple()[axis]) - 1) < 1e-6
      normal.delete()
      if (!alignedToCut) continue

      const centre = face.center
      const onCutPlane = Math.abs(centre.toTuple()[axis] - position) < 1e-6
      centre.delete()
      if (!onCutPlane) continue

      // `outerWire` and `innerWires` consume the face they are called on, so
      // each call gets its own copy and the original is released below.
      const outerWire = face.clone().outerWire()
      const outer = wireToPolygon(outerWire, xAxis, yAxis)
      outerWire.delete()
      if (outer.length < 3) continue

      const holes: Point2[][] = []
      for (const inner of face.clone().innerWires()) {
        const hole = wireToPolygon(inner, xAxis, yAxis)
        inner.delete()
        if (hole.length >= 3) holes.push(hole)
      }
      regions.push({ outer, holes })
    } finally {
      face.delete()
    }
  }
  return regions
}

export type SectionRequest = { parent: OrthographicViewId; position: number; label: string }

/**
 * Project one solid into the requested views.
 *
 * Pictorial views never carry hidden lines: dashes across an isometric read as
 * clutter rather than as information, and the orthographic views next to it are
 * where anything internal is meant to be found.
 */
export function projectViews(
  shape: Shape3D,
  viewIds: DrawingViewId[],
  includeHidden: boolean,
  section?: SectionRequest,
): ProjectedView[] {
  const views = viewIds
    .filter((id) => id !== 'section')
    .map((id) => projectOneView(shape, id, includeHidden && id !== 'iso'))

  if (section) views.push(projectSection(shape, section))
  return views
}

function projectOneView(shape: Shape3D, id: DrawingViewId, wantsHidden: boolean): ProjectedView {
  const { direction, xAxis } = VIEW_CAMERAS[id]
  const camera = new ProjectionCamera([0, 0, 0], direction, xAxis)

  try {
    const projected = makeProjectedEdges(shape, camera, wantsHidden)
    const visible = dedupeCurves(mergeArcsIntoCircles(convertEdges(projected.visible)))
    const hidden = wantsHidden
      ? suppressCoveredCurves(mergeArcsIntoCircles(convertEdges(projected.hidden)), visible)
      : []

    return { id, visible, hidden, bounds: combineBounds(curvesBounds(visible), curvesBounds(hidden)) }
  } finally {
    camera.delete()
  }
}

/**
 * Cut the solid and project what is left.
 *
 * A section carries no hidden lines: the whole point of cutting is to show the
 * interior directly, and dashes over an exposed face would say a second time,
 * less clearly, what the hatching already says.
 */
function projectSection(shape: Shape3D, request: SectionRequest): ProjectedView {
  const { axis, keepAbove } = VIEW_AXES[request.parent]
  const { direction, xAxis } = VIEW_CAMERAS[request.parent]
  const yAxis = cross(direction, xAxis)

  const bounds = shape.boundingBox.bounds as [Vec3, Vec3]
  const clamped = Math.min(1, Math.max(0, request.position))
  const position = bounds[0][axis] + (bounds[1][axis] - bounds[0][axis]) * clamped

  const sectioned = cutAwayNearSide(shape, axis, position, keepAbove, bounds)
  try {
    const camera = new ProjectionCamera([0, 0, 0], direction, xAxis)
    try {
      const projected = makeProjectedEdges(sectioned, camera, false)
      const visible = dedupeCurves(mergeArcsIntoCircles(convertEdges(projected.visible)))
      const regions = sectionRegions(sectioned, axis, position, xAxis, yAxis)

      return {
        id: 'section',
        visible,
        hidden: [],
        bounds: curvesBounds(visible),
        section: { parent: request.parent, label: request.label, position, regions },
      }
    } finally {
      camera.delete()
    }
  } finally {
    sectioned.delete()
  }
}
