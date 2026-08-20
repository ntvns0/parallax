import { describe, expect, it } from 'vitest'
import {
  ANCHOR_MATCH_DISTANCE_MM,
  COPLANAR_FACE_DISTANCE_MM,
  FACE_OWNERSHIP_DISTANCE_MM,
  FILLET_CORNER_CLUSTER_DISTANCE_MM,
  FILLET_EDGE_ENDPOINT_SCORE_MM2,
  FILLET_EDGE_POINT_SCORE_MM2,
  FILLET_SOURCE_LINE_DISTANCE_MM2,
  FILLET_VERTEX_DISTANCE_MM,
} from './tolerance-policy'

describe('geometric tolerance policy', () => {
  it('keeps model references stricter than presentation-only ownership', () => {
    expect(ANCHOR_MATCH_DISTANCE_MM).toBeLessThan(FACE_OWNERSHIP_DISTANCE_MM)
    expect(COPLANAR_FACE_DISTANCE_MM).toBeLessThan(ANCHOR_MATCH_DISTANCE_MM)
  })

  it('names squared fillet scores separately from linear distances', () => {
    expect(FILLET_EDGE_POINT_SCORE_MM2).toBe(FILLET_SOURCE_LINE_DISTANCE_MM2)
    expect(FILLET_EDGE_ENDPOINT_SCORE_MM2).toBe(FILLET_EDGE_POINT_SCORE_MM2 * 2)
    expect(FILLET_VERTEX_DISTANCE_MM ** 2).toBeLessThan(FILLET_EDGE_POINT_SCORE_MM2)
  })

  it('allows corner clustering to absorb more tessellation drift than adjacency matching', () => {
    expect(FILLET_CORNER_CLUSTER_DISTANCE_MM).toBeGreaterThan(FILLET_VERTEX_DISTANCE_MM)
  })
})
