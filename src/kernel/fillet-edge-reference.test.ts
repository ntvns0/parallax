import { describe, expect, it } from 'vitest'
import { matchesFilletEdge, matchesFilletSourceEdge, expandConnectedFilletEdges, completeCornerVertexFillets, extractMeshEdges, areEdgesTangent, pointsTouch } from './fillet-edge-reference'
import type { FilletEdgeReference } from '../core/model'
import { FILLET_SOURCE_LINE_DISTANCE_MM2, FILLET_VERTEX_DISTANCE_MM } from '../core/tolerance-policy'

describe('fillet edge references', () => {
  const edge = { start: [0, 0, 10], end: [40, 0, 10], middle: [20, 0, 10] } as const

  it('matches a click anywhere along a straight edge', () => {
    expect(matchesFilletEdge(edge, {
      point: [7.5, 0, 10],
      start: [0, 0, 10],
      end: [40, 0, 10],
    })).toBe(true)
  })

  it('matches reversed edge orientation', () => {
    expect(matchesFilletEdge(edge, {
      point: [20, 0, 10],
      start: [40, 0, 10],
      end: [0, 0, 10],
    })).toBe(true)
  })

  it('does not round a nearby parallel edge', () => {
    expect(matchesFilletEdge(edge, {
      point: [7.5, 1, 10],
      start: [0, 1, 10],
      end: [40, 1, 10],
    })).toBe(false)
  })

  it('enforces the persisted endpoint score boundary', () => {
    expect(matchesFilletEdge(edge, { point: [20, 0, 10], start: [0, 0.199, 10], end: [40, 0.199, 10] })).toBe(true)
    expect(matchesFilletEdge(edge, { point: [20, 0, 10], start: [0, 0.201, 10], end: [40, 0.201, 10] })).toBe(false)
  })
})

describe('fillet source edge references', () => {
  const source = { start: [0, 0, 0], end: [10, 0, 0], middle: [5, 0, 0] } as const

  it('maps an edge trimmed by an adjoining fillet back to its sharp source', () => {
    expect(matchesFilletSourceEdge(source, {
      start: [2, 0, 0],
      end: [10, 0, 0],
      point: [6, 0, 0],
    })).toBe(true)
  })

  it('does not match a separate collinear edge', () => {
    expect(matchesFilletSourceEdge(source, {
      start: [11, 0, 0],
      end: [14, 0, 0],
      point: [12.5, 0, 0],
    })).toBe(false)
  })

  it('does not broaden curved-edge references to their endpoint chord', () => {
    expect(matchesFilletSourceEdge(source, {
      start: [2, 0, 0],
      end: [8, 0, 0],
      point: [5, 1, 0],
    })).toBe(false)
  })

  it('enforces the source-line distance boundary', () => {
    const limit = Math.sqrt(FILLET_SOURCE_LINE_DISTANCE_MM2)
    expect(matchesFilletSourceEdge(source, { start: [2, limit - 0.001, 0], end: [8, limit - 0.001, 0], point: [5, limit - 0.001, 0] })).toBe(true)
    expect(matchesFilletSourceEdge(source, { start: [2, limit + 0.001, 0], end: [8, limit + 0.001, 0], point: [5, limit + 0.001, 0] })).toBe(false)
  })
})

describe('connected edge propagation and corner completion', () => {
  const e1 = { start: [0, 0, 10], end: [40, 0, 10], middle: [20, 0, 10] }
  const e2 = { start: [0, 0, 10], end: [0, 40, 10], middle: [0, 20, 10] }
  const e3 = { start: [0, 0, 10], end: [0, 0, 0], middle: [0, 0, 5] }
  const e4 = { start: [40, 0, 10], end: [40, 40, 10], middle: [40, 20, 10] }
  const e1_collinear = { start: [40, 0, 10], end: [80, 0, 10], middle: [60, 0, 10] }

  it('uses the policy boundary for shared vertices', () => {
    expect(pointsTouch([0, 0, 0], [FILLET_VERTEX_DISTANCE_MM - 0.001, 0, 0])).toBe(true)
    expect(pointsTouch([0, 0, 0], [FILLET_VERTEX_DISTANCE_MM, 0, 0])).toBe(false)
  })

  it('detects smooth tangent edge connections', () => {
    expect(areEdgesTangent(e1, e1_collinear)).toBe(true)
    expect(areEdgesTangent(e1, e2)).toBe(false)
  })

  it('expands seed edge selection to connected edges sharing a vertex when requireTangent is false', () => {
    const seed: FilletEdgeReference = { start: [0, 0, 10], end: [40, 0, 10], point: [20, 0, 10] }
    const expanded = expandConnectedFilletEdges([seed], [e1, e2, e3, e4], false)
    expect(expanded.length).toBe(4)
  })

  it('only expands across tangent edges when requireTangent is true', () => {
    const seed: FilletEdgeReference = { start: [0, 0, 10], end: [40, 0, 10], point: [20, 0, 10] }
    const expanded = expandConnectedFilletEdges([seed], [e1, e2, e3, e4, e1_collinear], true)
    expect(expanded.length).toBe(2)
  })

  it('auto-completes 3-valent corner vertices when 2 of 3 edges are filleted in spherical mode', () => {
    const baseRadiusMap = [2.0, 2.0, null, null]
    const completed = completeCornerVertexFillets([e1, e2, e3, e4], baseRadiusMap)
    expect(completed[2]).toBe(2.0)
    expect(completed[3]).toBeNull()
  })

  it('extracts edge geometries from kernel mesh representation', () => {
    const mesh = {
      edgeLines: [0, 0, 10, 40, 0, 10, 0, 0, 10, 0, 40, 10],
      edgeGroups: [
        { start: 0, count: 2, edgeId: 1 },
      ],
    }
    const extracted = extractMeshEdges(mesh)
    expect(extracted.length).toBe(1)
    expect(extracted[0].start).toEqual([0, 0, 10])
    expect(extracted[0].end).toEqual([40, 0, 10])
  })
})
