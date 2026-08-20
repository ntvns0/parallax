import type { FeatureKind, Vec3 } from './model'

export type MeasurementSnapType = 'vertex' | 'edge midpoint' | 'edge' | 'hole center' | 'face center' | 'feature center' | 'surface'

export const MEASUREMENT_SNAP_RADIUS_PX = 18

const MEASUREMENT_SNAP_PRIORITY: Record<MeasurementSnapType, number> = {
  vertex: 0,
  'hole center': 1,
  'edge midpoint': 2,
  'face center': 3,
  'feature center': 4,
  edge: 5,
  surface: 6,
}

/** Prefer stable design-intent targets before continuous projections. */
export function compareMeasurementSnapCandidates(
  left: { snapType: MeasurementSnapType; distance: number },
  right: { snapType: MeasurementSnapType; distance: number },
) {
  return MEASUREMENT_SNAP_PRIORITY[left.snapType] - MEASUREMENT_SNAP_PRIORITY[right.snapType]
    || left.distance - right.distance
}

export type MeasurementReference = {
  point: Vec3
  featureId: string
  featureName: string
  featureKind: FeatureKind
  snapType: MeasurementSnapType
  radius?: number
  edgeSegments?: { start: Vec3; end: Vec3 }[]
}

export type MeasurementState = {
  hover: MeasurementReference | null
  start: MeasurementReference | null
  end: MeasurementReference | null
}

export function measurementValues(start: Vec3, end: Vec3) {
  const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  return {
    delta,
    distance: Math.hypot(...delta),
  }
}

export function measurementEdgeDirection(reference: MeasurementReference): Vec3 | null {
  const segments = reference.edgeSegments?.filter((segment) => Math.hypot(
    segment.end[0] - segment.start[0],
    segment.end[1] - segment.start[1],
    segment.end[2] - segment.start[2],
  ) > 1e-9)
  if (!segments?.length) return null
  const first = segments[0]
  const firstLength = Math.hypot(
    first.end[0] - first.start[0],
    first.end[1] - first.start[1],
    first.end[2] - first.start[2],
  )
  const direction: Vec3 = [
    (first.end[0] - first.start[0]) / firstLength,
    (first.end[1] - first.start[1]) / firstLength,
    (first.end[2] - first.start[2]) / firstLength,
  ]
  // A curved edge has no single direction and should not produce a misleading
  // chord angle. Segmented straight edges remain eligible.
  for (const segment of segments.slice(1)) {
    const delta: Vec3 = [
      segment.end[0] - segment.start[0],
      segment.end[1] - segment.start[1],
      segment.end[2] - segment.start[2],
    ]
    const length = Math.hypot(...delta)
    const alignment = Math.abs((delta[0] * direction[0] + delta[1] * direction[1] + delta[2] * direction[2]) / length)
    if (alignment < Math.cos(Math.PI / 180)) return null
  }
  return direction
}

/** Included angle for two undirected linear edge snaps, in degrees. */
export function measurementEdgeAngle(first: MeasurementReference, second: MeasurementReference) {
  const firstDirection = measurementEdgeDirection(first)
  const secondDirection = measurementEdgeDirection(second)
  if (!firstDirection || !secondDirection) return null
  const dot = Math.abs(
    firstDirection[0] * secondDirection[0]
    + firstDirection[1] * secondDirection[1]
    + firstDirection[2] * secondDirection[2]
  )
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
}

function normalizedDegrees(radians: number) {
  const degrees = radians * 180 / Math.PI
  return (degrees + 360) % 360
}

export type MeasurementLineOrientation =
  | { kind: 'planar'; plane: 'XY' | 'XZ' | 'YZ'; datumAxis: '+X' | '+Y'; bearing: number }
  | { kind: 'spatial'; azimuth: number; elevation: number }

/** Absolute direction of the yellow point-to-point measurement line. */
export function measurementLineOrientation(start: Vec3, end: Vec3): MeasurementLineOrientation | null {
  const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const length = Math.hypot(...delta)
  if (length < 1e-9) return null
  const planarTolerance = Math.max(1e-7, length * 1e-6)
  if (Math.abs(delta[2]) <= planarTolerance) {
    return { kind: 'planar', plane: 'XY', datumAxis: '+X', bearing: normalizedDegrees(Math.atan2(delta[1], delta[0])) }
  }
  if (Math.abs(delta[1]) <= planarTolerance) {
    return { kind: 'planar', plane: 'XZ', datumAxis: '+X', bearing: normalizedDegrees(Math.atan2(delta[2], delta[0])) }
  }
  if (Math.abs(delta[0]) <= planarTolerance) {
    return { kind: 'planar', plane: 'YZ', datumAxis: '+Y', bearing: normalizedDegrees(Math.atan2(delta[2], delta[1])) }
  }
  return {
    kind: 'spatial',
    azimuth: normalizedDegrees(Math.atan2(delta[1], delta[0])),
    elevation: Math.asin(delta[2] / length) * 180 / Math.PI,
  }
}

/** Smaller and supplementary angles from the starting edge to the measurement line. */
export function measurementRelativeEdgeAngles(reference: MeasurementReference, start: Vec3, end: Vec3) {
  const edgeDirection = measurementEdgeDirection(reference)
  const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const length = Math.hypot(...delta)
  if (!edgeDirection || length < 1e-9) return null
  const dot = Math.abs((
    edgeDirection[0] * delta[0]
    + edgeDirection[1] * delta[1]
    + edgeDirection[2] * delta[2]
  ) / length)
  const smaller = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
  return { smaller, supplementary: 180 - smaller }
}

export function findCircularLoopCenters(segments: { start: Vec3; end: Vec3 }[]) {
  const groups: { start: Vec3; end: Vec3 }[][] = [segments]
  for (let axis = 0; axis < 3; axis += 1) {
    const planes = new Map<number, { start: Vec3; end: Vec3 }[]>()
    for (const segment of segments) {
      if (Math.abs(segment.start[axis] - segment.end[axis]) > 0.001) continue
      const plane = Math.round((segment.start[axis] + segment.end[axis]) * 500)
      const existing = planes.get(plane) ?? []
      existing.push(segment)
      planes.set(plane, existing)
    }
    groups.push(...Array.from(planes.values()).filter((group) => group.length >= 8))
  }

  const keyFor = (point: Vec3) => point.map((value) => Math.round(value * 1000)).join(',')
  const loops: { center: Vec3; radius: number }[] = []
  for (const group of groups) {
    const points = new Map<string, Vec3>()
    const neighbors = new Map<string, Set<string>>()
    for (const segment of group) {
      const startKey = keyFor(segment.start)
      const endKey = keyFor(segment.end)
      points.set(startKey, segment.start)
      points.set(endKey, segment.end)
      if (!neighbors.has(startKey)) neighbors.set(startKey, new Set())
      if (!neighbors.has(endKey)) neighbors.set(endKey, new Set())
      neighbors.get(startKey)?.add(endKey)
      neighbors.get(endKey)?.add(startKey)
    }

    const visited = new Set<string>()
    for (const startKey of points.keys()) {
      if (visited.has(startKey)) continue
      const pending = [startKey]
      const component: string[] = []
      visited.add(startKey)
      while (pending.length) {
        const key = pending.pop()!
        component.push(key)
        for (const neighbor of neighbors.get(key) ?? []) {
          if (visited.has(neighbor)) continue
          visited.add(neighbor)
          pending.push(neighbor)
        }
      }
      if (component.length < 8 || component.some((key) => neighbors.get(key)?.size !== 2)) continue
      const componentPoints = component.map((key) => points.get(key)!)
      const minimum: Vec3 = [0, 1, 2].map((axis) => Math.min(...componentPoints.map((point) => point[axis]))) as Vec3
      const maximum: Vec3 = [0, 1, 2].map((axis) => Math.max(...componentPoints.map((point) => point[axis]))) as Vec3
      const extents: Vec3 = [maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]]
      const planeAxis = extents.indexOf(Math.min(...extents))
      const planarExtents = extents.filter((_, axis) => axis !== planeAxis)
      const largestExtent = Math.max(...planarExtents)
      if (largestExtent < 1e-6 || extents[planeAxis] > largestExtent * 0.02 || Math.min(...planarExtents) / largestExtent < 0.9) continue
      const center: Vec3 = [
        (minimum[0] + maximum[0]) / 2,
        (minimum[1] + maximum[1]) / 2,
        (minimum[2] + maximum[2]) / 2,
      ]
      const planarAxes = [0, 1, 2].filter((axis) => axis !== planeAxis)
      const radii = componentPoints.map((point) => Math.hypot(point[planarAxes[0]] - center[planarAxes[0]], point[planarAxes[1]] - center[planarAxes[1]]))
      const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length
      if (Math.max(...radii.map((value) => Math.abs(value - radius))) > radius * 0.05) continue
      if (!loops.some((loop) => Math.hypot(loop.center[0] - center[0], loop.center[1] - center[1], loop.center[2] - center[2]) < 0.001 && Math.abs(loop.radius - radius) < 0.001)) {
        loops.push({ center, radius })
      }
    }
  }
  return loops
}
