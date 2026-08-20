import type { FilletEdgeReference } from '../core/model'
import {
  FILLET_CORNER_CLUSTER_DISTANCE_MM,
  FILLET_CURVE_CHORD_DISTANCE_MM2,
  FILLET_EDGE_ENDPOINT_SCORE_MM2,
  FILLET_EDGE_POINT_SCORE_MM2,
  FILLET_SOURCE_LINE_DISTANCE_MM2,
  FILLET_VERTEX_DISTANCE_MM,
} from '../core/tolerance-policy'

function squaredDistance(left: readonly number[], right: readonly number[]) {
  return left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0)
}

function squaredDistanceToSegment(point: readonly number[], start: readonly number[], end: readonly number[]) {
  const delta = end.map((value, index) => value - start[index])
  const lengthSquared = delta.reduce((total, value) => total + value ** 2, 0)
  const fraction = lengthSquared < 1e-12
    ? 0
    : Math.max(0, Math.min(1, delta.reduce((total, value, index) => total + (point[index] - start[index]) * value, 0) / lengthSquared))
  const closest = start.map((value, index) => value + delta[index] * fraction)
  return squaredDistance(point, closest)
}

function subtract(left: readonly number[], right: readonly number[]) {
  return left.map((value, index) => value - right[index])
}

function dot(left: readonly number[], right: readonly number[]) {
  return left.reduce((total, value, index) => total + value * right[index], 0)
}

function squaredLength(vector: readonly number[]) {
  return dot(vector, vector)
}

function squaredDistanceToLine(point: readonly number[], start: readonly number[], direction: readonly number[]) {
  const offset = subtract(point, start)
  const directionLength = squaredLength(direction)
  if (directionLength < 1e-12) return squaredLength(offset)
  const fraction = dot(offset, direction) / directionLength
  return squaredLength(offset.map((value, index) => value - direction[index] * fraction))
}

/** Match a persisted viewport selection to a freshly replayed B-rep edge. */
export function matchesFilletEdge(
  edge: { start: readonly number[]; end: readonly number[]; middle: readonly number[] },
  reference: FilletEdgeReference,
) {
  const endpointScore = Math.min(
    squaredDistance(edge.start, reference.start) + squaredDistance(edge.end, reference.end),
    squaredDistance(edge.start, reference.end) + squaredDistance(edge.end, reference.start),
  )
  const pointScore = Math.min(
    squaredDistance(edge.middle, reference.point),
    squaredDistanceToSegment(reference.point, edge.start, edge.end),
  )
  return pointScore < FILLET_EDGE_POINT_SCORE_MM2 && endpointScore < FILLET_EDGE_ENDPOINT_SCORE_MM2
}

/**
 * Match a straight edge selected after an earlier fillet to the longer sharp
 * edge from which it came. OpenCascade trims adjoining edges as soon as one
 * edge is rounded, so exact endpoint matching alone cannot consolidate a set
 * of connected fillets into one stable builder operation.
 */
export function matchesFilletSourceEdge(
  edge: { start: readonly number[]; end: readonly number[]; middle: readonly number[] },
  reference: FilletEdgeReference,
) {
  if (matchesFilletEdge(edge, reference)) return true

  const edgeDirection = subtract(edge.end, edge.start)
  const referenceDirection = subtract(reference.end, reference.start)
  const edgeLengthSquared = squaredLength(edgeDirection)
  const referenceLengthSquared = squaredLength(referenceDirection)
  if (edgeLengthSquared < 1e-8 || referenceLengthSquared < 1e-8) return false

  // Tessellated curved edges have a midpoint away from their endpoint chord;
  // never broaden their identity to a merely nearby straight source edge.
  const edgeChordMiddle = edge.start.map((value, index) => (value + edge.end[index]) / 2)
  const referenceChordMiddle = reference.start.map((value, index) => (value + reference.end[index]) / 2)
  if (squaredDistance(edge.middle, edgeChordMiddle) > FILLET_CURVE_CHORD_DISTANCE_MM2
    || squaredDistance(reference.point, referenceChordMiddle) > FILLET_CURVE_CHORD_DISTANCE_MM2) return false

  const cosineSquared = dot(edgeDirection, referenceDirection) ** 2 / (edgeLengthSquared * referenceLengthSquared)
  if (cosineSquared < 0.9999) return false
  if (squaredDistanceToLine(reference.start, edge.start, edgeDirection) > FILLET_SOURCE_LINE_DISTANCE_MM2) return false
  if (squaredDistanceToLine(reference.end, edge.start, edgeDirection) > FILLET_SOURCE_LINE_DISTANCE_MM2) return false

  const referenceStart = dot(subtract(reference.start, edge.start), edgeDirection) / edgeLengthSquared
  const referenceEnd = dot(subtract(reference.end, edge.start), edgeDirection) / edgeLengthSquared
  const low = Math.min(referenceStart, referenceEnd)
  const high = Math.max(referenceStart, referenceEnd)
  // Require real interval overlap, preventing a separate collinear edge from
  // being mistaken for the selected one.
  return Math.min(1, high) - Math.max(0, low) > 1e-4
}

export type EdgeGeometry = { start: readonly number[]; end: readonly number[]; middle: readonly number[] }

/** Check if two 3D points are within vertex snapping tolerance of each other. */
export function pointsTouch(p1: readonly number[], p2: readonly number[], tolerance = FILLET_VERTEX_DISTANCE_MM): boolean {
  return squaredDistance(p1, p2) < tolerance * tolerance
}

/** Check if two edges share a vertex endpoint. */
export function edgesShareVertex(e1: { start: readonly number[]; end: readonly number[] }, e2: { start: readonly number[]; end: readonly number[] }): boolean {
  return pointsTouch(e1.start, e2.start) || pointsTouch(e1.start, e2.end) || pointsTouch(e1.end, e2.start) || pointsTouch(e1.end, e2.end)
}

/** Check if two connected edges are smoothly tangent at their shared vertex. */
export function areEdgesTangent(
  e1: EdgeGeometry,
  e2: EdgeGeometry,
  maxAngleDegrees = 45,
): boolean {
  let dir1: number[] | null = null
  let dir2: number[] | null = null

  if (pointsTouch(e1.end, e2.start)) {
    dir1 = subtract(e1.end, e1.start)
    dir2 = subtract(e2.end, e2.start)
  } else if (pointsTouch(e1.end, e2.end)) {
    dir1 = subtract(e1.end, e1.start)
    dir2 = subtract(e2.start, e2.end)
  } else if (pointsTouch(e1.start, e2.start)) {
    dir1 = subtract(e1.start, e1.end)
    dir2 = subtract(e2.end, e2.start)
  } else if (pointsTouch(e1.start, e2.end)) {
    dir1 = subtract(e1.start, e1.end)
    dir2 = subtract(e2.start, e2.end)
  }

  if (!dir1 || !dir2) return false

  const len1 = Math.sqrt(squaredLength(dir1))
  const len2 = Math.sqrt(squaredLength(dir2))
  if (len1 < 1e-6 || len2 < 1e-6) return false

  const cosAngle = dot(dir1, dir2) / (len1 * len2)
  return cosAngle > Math.cos((maxAngleDegrees * Math.PI) / 180)
}

/**
 * Expand a set of seed edge references to include connected edges sharing vertices.
 * If `requireTangent` is true (default), propagation only follows smooth tangent chains
 * without crossing sharp 90-degree corners.
 */
export function expandConnectedFilletEdges(
  seeds: FilletEdgeReference[],
  allEdges: EdgeGeometry[],
  requireTangent = true,
): FilletEdgeReference[] {
  if (!seeds.length || !allEdges.length) return seeds

  const seedIndices = new Set<number>()
  allEdges.forEach((edge, index) => {
    if (seeds.some((seed) => matchesFilletSourceEdge(edge, seed))) {
      seedIndices.add(index)
    }
  })

  if (!seedIndices.size) return seeds

  const connectedIndices = new Set<number>(seedIndices)
  let added = true
  while (added) {
    added = false
    allEdges.forEach((candidate, cIdx) => {
      if (connectedIndices.has(cIdx)) return
      for (const idx of connectedIndices) {
        const parent = allEdges[idx]
        if (edgesShareVertex(parent, candidate) && (!requireTangent || areEdgesTangent(parent, candidate))) {
          connectedIndices.add(cIdx)
          added = true
          break
        }
      }
    })
  }

  const result: FilletEdgeReference[] = []
  connectedIndices.forEach((idx) => {
    const edge = allEdges[idx]
    result.push({
      start: [...edge.start] as [number, number, number],
      end: [...edge.end] as [number, number, number],
      point: [...edge.middle] as [number, number, number],
    })
  })

  return result
}

/**
 * Automatically complete fillets for 3-valent (or multi-valent) corner vertices.
 * If at least 2 edges meeting at a vertex are filleted, unfilleted edges meeting
 * at that same vertex are assigned the adjacent radius to prevent OpenCascade
 * from producing topological corner holes.
 */
export function completeCornerVertexFillets(
  allEdges: EdgeGeometry[],
  baseRadiusMap: (number | null)[],
  tolerance = FILLET_CORNER_CLUSTER_DISTANCE_MM,
): (number | null)[] {
  const result = [...baseRadiusMap]

  const vertices: { position: readonly number[]; edgeIndices: number[] }[] = []

  const addVertexPoint = (p: readonly number[], edgeIdx: number) => {
    for (const v of vertices) {
      if (pointsTouch(v.position, p, tolerance)) {
        if (!v.edgeIndices.includes(edgeIdx)) {
          v.edgeIndices.push(edgeIdx)
        }
        return
      }
    }
    vertices.push({ position: p, edgeIndices: [edgeIdx] })
  }

  allEdges.forEach((edge, index) => {
    addVertexPoint(edge.start, index)
    addVertexPoint(edge.end, index)
  })

  let changed = false
  for (const v of vertices) {
    const edgeIndices = v.edgeIndices
    if (edgeIndices.length < 3) continue
    const filletedIndices = edgeIndices.filter((idx) => {
      const val = result[idx]
      if (val === null || val === undefined) return false
      if (typeof val === 'number') return val > 0
      if (Array.isArray(val)) return val[0] > 0
      return false
    })

    if (filletedIndices.length >= 2 && filletedIndices.length < edgeIndices.length) {
      const radii = filletedIndices.map((idx) => {
        const val = result[idx]!
        return typeof val === 'number' ? val : (val as unknown as [number, number])[0]
      })
      const maxRadius = Math.max(...radii)
      edgeIndices.forEach((idx) => {
        if (result[idx] === null || result[idx] === undefined) {
          result[idx] = maxRadius
          changed = true
        }
      })
    }
  }

  return changed ? result : baseRadiusMap
}

/** Extract edge geometries from a kernel mesh representation. */
export function extractMeshEdges(mesh: { edgeLines: number[]; edgeGroups?: { start: number; count: number; edgeId: number }[] }): EdgeGeometry[] {
  const result: EdgeGeometry[] = []
  const { edgeLines, edgeGroups } = mesh
  if (!edgeLines || !edgeLines.length) return result
  if (edgeGroups?.length) {
    for (const group of edgeGroups) {
      if (group.count < 2) continue
      const startIdx = group.start * 3
      const endIdx = (group.start + group.count - 1) * 3
      if (endIdx + 2 >= edgeLines.length) continue
      const start = [edgeLines[startIdx], edgeLines[startIdx + 1], edgeLines[startIdx + 2]]
      const end = [edgeLines[endIdx], edgeLines[endIdx + 1], edgeLines[endIdx + 2]]
      const midIdx = (group.start + Math.floor(group.count / 2)) * 3
      const middle = [edgeLines[midIdx], edgeLines[midIdx + 1], edgeLines[midIdx + 2]]
      result.push({ start, end, middle })
    }
  } else {
    for (let i = 0; i + 5 < edgeLines.length; i += 6) {
      const start = [edgeLines[i], edgeLines[i + 1], edgeLines[i + 2]]
      const end = [edgeLines[i + 3], edgeLines[i + 4], edgeLines[i + 5]]
      const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]
      result.push({ start, end, middle })
    }
  }
  return result
}
