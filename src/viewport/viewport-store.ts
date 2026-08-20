import { create } from 'zustand'

/**
 * Viewport display preferences.
 *
 * These describe how the part is *shown*, not what it is, so they live outside
 * the document: changing the brightness must never mark a project unsaved, and
 * the preference should follow the person rather than the file they opened.
 */

const STORAGE_KEY = 'parallax:viewport'

export const MIN_BRIGHTNESS = 0.4
export const MAX_BRIGHTNESS = 2

export type ProjectionMode = 'perspective' | 'orthographic'

function clampBrightness(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_BRIGHTNESS, Math.max(MIN_BRIGHTNESS, value))
}

function readStoredPreferences(): { brightness: number; projectionMode: ProjectionMode } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { brightness: 1, projectionMode: 'perspective' }
    const parsed = JSON.parse(raw) as { brightness?: number; projectionMode?: ProjectionMode }
    return {
      brightness: clampBrightness(parsed.brightness ?? 1),
      projectionMode: parsed.projectionMode === 'orthographic' ? 'orthographic' : 'perspective',
    }
  } catch {
    return { brightness: 1, projectionMode: 'perspective' }
  }
}

const stored = readStoredPreferences()

export const useViewportStore = create<{
  brightness: number
  setBrightness: (value: number) => void
  projectionMode: ProjectionMode
  setProjectionMode: (mode: ProjectionMode) => void
  /** How far the camera sits from the world origin, in millimetres. */
  cameraDistance: number
  setCameraDistance: (value: number) => void
}>((set, get) => ({
  cameraDistance: 0,
  setCameraDistance: (cameraDistance) => set((state) =>
    Math.abs(cameraDistance - state.cameraDistance) > Math.max(state.cameraDistance * 0.002, 0.01)
      ? { cameraDistance }
      : state),
  brightness: stored.brightness,
  setBrightness: (value) => {
    const brightness = clampBrightness(value)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ brightness, projectionMode: get().projectionMode }))
    } catch {
      // Ignore storage errors
    }
    set({ brightness })
  },
  projectionMode: stored.projectionMode,
  setProjectionMode: (projectionMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ brightness: get().brightness, projectionMode }))
    } catch {
      // Ignore storage errors
    }
    set({ projectionMode })
  },
}))
