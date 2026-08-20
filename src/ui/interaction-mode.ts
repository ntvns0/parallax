import type { FilletEdgeReference, FilletCornerStyle } from '../core/model'
import type { MeasurementState } from '../core/measurement'
import type { SketchFacePickResult } from '../viewport/SceneViewport'

export type InteractionMode =
  | { kind: 'idle' }
  | { kind: 'plane-picker' }
  | { kind: 'face-picker'; hover: SketchFacePickResult | null }
  | {
      kind: 'fillet-selection'
      targetId: string
      editingFeatureId?: string
      edges: FilletEdgeReference[]
      propagate: boolean
      cornerStyle: FilletCornerStyle
      radiusDraft: string
      status: { applying: boolean; error: string | null }
    }
  | { kind: 'measurement'; measurement: MeasurementState }

export const INITIAL_INTERACTION_MODE: InteractionMode = { kind: 'idle' }

export type InteractionAction =
  | { type: 'CANCEL' }
  | { type: 'OPEN_PLANE_PICKER' }
  | { type: 'START_FACE_PICKER' }
  | { type: 'SET_FACE_HOVER'; hover: SketchFacePickResult | null }
  | { type: 'START_FILLET'; targetId: string; initialRadiusDraft: string; initialCornerStyle?: FilletCornerStyle; editingFeatureId?: string }
  | { type: 'SET_FILLET_EDGES'; edges: FilletEdgeReference[] }
  | { type: 'ADD_FILLET_EDGES'; edgesToAdd: FilletEdgeReference[] }
  | { type: 'TOGGLE_FILLET_EDGES'; edgesToToggle: FilletEdgeReference[] }
  | { type: 'SET_FILLET_PROPAGATE'; propagate: boolean }
  | { type: 'SET_FILLET_CORNER_STYLE'; style: FilletCornerStyle }
  | { type: 'SET_FILLET_RADIUS_DRAFT'; draft: string }
  | { type: 'SET_FILLET_STATUS'; status: { applying: boolean; error: string | null } }
  | { type: 'TOGGLE_MEASUREMENT' }
  | { type: 'SET_MEASUREMENT'; measurement: MeasurementState }

export function interactionModeReducer(state: InteractionMode, action: InteractionAction): InteractionMode {
  switch (action.type) {
    case 'CANCEL':
      return { kind: 'idle' }

    case 'OPEN_PLANE_PICKER':
      return { kind: 'plane-picker' }

    case 'START_FACE_PICKER':
      return { kind: 'face-picker', hover: null }

    case 'SET_FACE_HOVER':
      if (state.kind !== 'face-picker') return state
      return { ...state, hover: action.hover }

    case 'START_FILLET':
      return {
        kind: 'fillet-selection',
        targetId: action.targetId,
        ...(action.editingFeatureId ? { editingFeatureId: action.editingFeatureId } : {}),
        edges: [],
        propagate: true,
        cornerStyle: action.initialCornerStyle ?? 'spherical',
        radiusDraft: action.initialRadiusDraft,
        status: { applying: false, error: null },
      }

    case 'SET_FILLET_EDGES':
      if (state.kind !== 'fillet-selection') return state
      return { ...state, edges: action.edges }

    case 'ADD_FILLET_EDGES': {
      if (state.kind !== 'fillet-selection') return state
      const updated = [...state.edges]
      for (const candidate of action.edgesToAdd) {
        if (!updated.some((existing) => Math.hypot(...existing.point.map((value, index) => value - candidate.point[index])) < 0.05)) {
          updated.push(candidate)
        }
      }
      return {
        ...state,
        edges: updated,
        status: { applying: false, error: null },
      }
    }

    case 'TOGGLE_FILLET_EDGES': {
      if (state.kind !== 'fillet-selection') return state
      const seed = action.edgesToToggle[0]
      const isSeedSelected = seed && state.edges.some((existing) =>
        Math.hypot(...existing.point.map((val, idx) => val - seed.point[idx])) < 0.05
      )

      let updated: FilletEdgeReference[]
      if (isSeedSelected) {
        updated = state.edges.filter((existing) =>
          !action.edgesToToggle.some((toRemove) =>
            Math.hypot(...existing.point.map((val, idx) => val - toRemove.point[idx])) < 0.05
          )
        )
      } else {
        updated = [...state.edges]
        for (const candidate of action.edgesToToggle) {
          if (!updated.some((existing) => Math.hypot(...existing.point.map((val, idx) => val - candidate.point[idx])) < 0.05)) {
            updated.push(candidate)
          }
        }
      }

      return {
        ...state,
        edges: updated,
        status: { applying: false, error: null },
      }
    }

    case 'SET_FILLET_PROPAGATE':
      if (state.kind !== 'fillet-selection') return state
      return { ...state, propagate: action.propagate }

    case 'SET_FILLET_CORNER_STYLE':
      if (state.kind !== 'fillet-selection') return state
      return { ...state, cornerStyle: action.style }

    case 'SET_FILLET_RADIUS_DRAFT':
      if (state.kind !== 'fillet-selection') return state
      return { ...state, radiusDraft: action.draft }

    case 'SET_FILLET_STATUS':
      if (state.kind !== 'fillet-selection') return state
      return { ...state, status: action.status }

    case 'TOGGLE_MEASUREMENT':
      if (state.kind === 'measurement') {
        return { kind: 'idle' }
      }
      return { kind: 'measurement', measurement: { hover: null, start: null, end: null } }

    case 'SET_MEASUREMENT':
      if (state.kind !== 'measurement') return state
      return { ...state, measurement: action.measurement }

    default:
      return state
  }
}
