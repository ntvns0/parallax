import type { useDocumentStore } from '../core/document-store'

/** The sketch tools, as the document store names them. */
export type EditorTool = ReturnType<typeof useDocumentStore.getState>['sketchTool']

/** Angle increments a line can be held to; 0 is smart inference. */
export type AngleSnap = 0 | 15 | 30 | 45

/** The tool bar, in order, with each tool's keyboard shortcut. */
export const SKETCH_TOOLS: readonly { tool: EditorTool; label: string; key: string; title?: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'line', label: 'Line', key: 'L' },
  { tool: 'rectangle', label: 'Rectangle', key: 'R' },
  { tool: 'circle', label: 'Circle', key: 'C' },
  { tool: 'arc', label: 'Arc', key: 'A', title: 'Click centre, arc start, then arc end' },
  { tool: 'three-point-arc', label: '3-Point Arc', key: 'G', title: 'Start, end, then a point on the arc' },
  { tool: 'tangent-arc', label: 'Tangent Arc', key: 'T', title: 'Choose an existing endpoint, then the new arc endpoint' },
  { tool: 'point', label: 'Point', key: 'P', title: 'Click to place a point: where a hole goes, or something to dimension from' },
  { tool: 'trim', label: 'Trim', key: 'X', title: 'Click a piece of a curve to cut it back to where its neighbours cross it' },
]

/** The tool a single-key shortcut picks, or null. */
export function toolForKey(key: string): EditorTool | null {
  if (key.length !== 1) return null
  return SKETCH_TOOLS.find((entry) => entry.key === key.toUpperCase())?.tool ?? null
}
