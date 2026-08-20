import { describe, expect, it } from 'vitest'
import { interactionModeReducer, INITIAL_INTERACTION_MODE } from './interaction-mode'

describe('interactionModeReducer', () => {
  it('starts in idle mode', () => {
    expect(INITIAL_INTERACTION_MODE).toEqual({ kind: 'idle' })
  })

  it('handles plane-picker mode transitions', () => {
    const s1 = interactionModeReducer(INITIAL_INTERACTION_MODE, { type: 'OPEN_PLANE_PICKER' })
    expect(s1).toEqual({ kind: 'plane-picker' })
    const s2 = interactionModeReducer(s1, { type: 'CANCEL' })
    expect(s2).toEqual({ kind: 'idle' })
  })

  it('handles face-picker mode transitions', () => {
    const s1 = interactionModeReducer(INITIAL_INTERACTION_MODE, { type: 'START_FACE_PICKER' })
    expect(s1).toEqual({ kind: 'face-picker', hover: null })
  })

  it('handles measurement mode toggle and updates', () => {
    const s1 = interactionModeReducer(INITIAL_INTERACTION_MODE, { type: 'TOGGLE_MEASUREMENT' })
    expect(s1).toEqual({ kind: 'measurement', measurement: { hover: null, start: null, end: null } })
    const s2 = interactionModeReducer(s1, { type: 'TOGGLE_MEASUREMENT' })
    expect(s2).toEqual({ kind: 'idle' })
  })

  it('handles fillet mode start, edge toggles, additions, and cancel', () => {
    const s1 = interactionModeReducer(INITIAL_INTERACTION_MODE, {
      type: 'START_FILLET',
      targetId: 'f-1',
      initialRadiusDraft: '2 mm',
    })
    expect(s1.kind).toBe('fillet-selection')
    if (s1.kind !== 'fillet-selection') return

    expect(s1.targetId).toBe('f-1')
    expect(s1.edges).toHaveLength(0)

    const edgeRef = {
      start: [0, 0, 0] as [number, number, number],
      end: [10, 0, 0] as [number, number, number],
      point: [5, 0, 0] as [number, number, number],
    }

    // Toggle ON (Select edge)
    const s2 = interactionModeReducer(s1, { type: 'TOGGLE_FILLET_EDGES', edgesToToggle: [edgeRef] })
    expect(s2.kind).toBe('fillet-selection')
    if (s2.kind !== 'fillet-selection') return
    expect(s2.edges).toHaveLength(1)

    // Toggle OFF (Deselect edge)
    const s3 = interactionModeReducer(s2, { type: 'TOGGLE_FILLET_EDGES', edgesToToggle: [edgeRef] })
    if (s3.kind !== 'fillet-selection') return
    expect(s3.edges).toHaveLength(0)

    // Toggle ON again
    const s4 = interactionModeReducer(s3, { type: 'TOGGLE_FILLET_EDGES', edgesToToggle: [edgeRef] })
    if (s4.kind !== 'fillet-selection') return
    expect(s4.edges).toHaveLength(1)

    const s5 = interactionModeReducer(s4, { type: 'CANCEL' })
    expect(s5).toEqual({ kind: 'idle' })
  })

  it('retains the fillet being edited during edge reselection', () => {
    const state = interactionModeReducer(INITIAL_INTERACTION_MODE, {
      type: 'START_FILLET', targetId: 'extrude-1', editingFeatureId: 'fillet-1',
      initialRadiusDraft: '3 mm', initialCornerStyle: 'mitered',
    })
    expect(state).toMatchObject({
      kind: 'fillet-selection', targetId: 'extrude-1', editingFeatureId: 'fillet-1',
      radiusDraft: '3 mm', cornerStyle: 'mitered', edges: [],
    })
  })
})
