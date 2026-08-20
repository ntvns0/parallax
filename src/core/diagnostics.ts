import { resolveFaceOffset } from './face-anchor'
import type { Feature } from './model'
import { create } from 'zustand'

export type DiagnosticLevel = 'info' | 'warning' | 'error'

/** One vocabulary for feature problems, regardless of which evaluator found them. */
export type FeatureDiagnostic = {
  featureId: string
  featureName: string
  severity: 'warning' | 'error'
  code: 'unresolved-edge' | 'unresolved-face' | 'constraint-conflict' | 'oversized-fillet' | 'invalid-formula'
  reason: 'missing' | 'moved' | 'invalid' | 'conflicting' | 'limit-exceeded'
  subject: { kind: 'edge' | 'face' | 'constraint' | 'parameter' | 'feature'; id?: string; label: string }
  message: string
  repairs: DiagnosticRepair[]
  /** Retained on the wire for compatibility; repair controls use `repairs`. */
  suggestedRadius?: number
}

export type DiagnosticRepair =
  | { kind: 'reselect-edge'; label: string }
  | { kind: 'reselect-face'; label: string }
  | { kind: 'restore-feature'; label: string; featureId: string }
  | { kind: 'edit-constraint'; label: string; constraintId: string }
  | { kind: 'apply-radius'; label: string; value: number }
  /** Drop a formula that no longer evaluates, keeping the last value it produced. */
  | { kind: 'clear-formula'; label: string; featureId: string; key: string }

export const useFeatureDiagnosticsStore = create<{ unresolved: Record<string, FeatureDiagnostic> }>(() => ({ unresolved: {} }))

/** Replace diagnostics for evaluated owners, clearing issues that now resolve. */
export function recordFeatureDiagnostics(featureIds: string[], diagnostics: FeatureDiagnostic[]) {
  useFeatureDiagnosticsStore.setState((state) => {
    const next = { ...state.unresolved }
    for (const featureId of featureIds) delete next[featureId]
    for (const diagnostic of diagnostics) next[diagnostic.featureId] = diagnostic
    return { unresolved: next }
  })
}

export function findDiagnosticRepair<K extends DiagnosticRepair['kind']>(
  diagnostic: FeatureDiagnostic,
  kind: K,
): Extract<DiagnosticRepair, { kind: K }> | undefined {
  return diagnostic.repairs.find((repair): repair is Extract<DiagnosticRepair, { kind: K }> => repair.kind === kind)
}

/** Face anchors are resolved outside the kernel, so diagnose them from the document. */
export function collectFaceReferenceDiagnostics(features: Feature[]): Record<string, FeatureDiagnostic> {
  const found: Record<string, FeatureDiagnostic> = {}
  for (const feature of features) {
    if (feature.kind !== 'sketch' || !feature.attachment?.anchor) continue
    const anchor = feature.attachment.anchor
    if (resolveFaceOffset(anchor, features) !== null) continue
    const host = features.find((candidate) => candidate.id === anchor.featureId)
    const missing = !host
    found[feature.id] = {
      featureId: feature.id,
      featureName: feature.name,
      severity: 'warning',
      code: 'unresolved-face',
      reason: missing ? 'missing' : 'invalid',
      subject: { kind: 'face', id: anchor.featureId, label: `${feature.attachment.featureName} · ${feature.attachment.faceLabel}` },
      message: missing
        ? `${feature.name} cannot find ${feature.attachment.featureName}, which supplied its ${feature.attachment.faceLabel.toLowerCase()}. The sketch is using its last known plane position until that feature is restored or a new face is selected.`
        : `${feature.name}'s saved face no longer resolves to an extrusion cap. The sketch is using its last known plane position; select a new face to repair the attachment.`,
      repairs: missing
        ? [{ kind: 'restore-feature', label: `Restore ${feature.attachment.featureName}`, featureId: anchor.featureId }, { kind: 'reselect-face', label: 'Select a new face' }]
        : [{ kind: 'reselect-face', label: 'Select a new face' }],
    }
  }
  return found
}

export type DiagnosticEntry = {
  id: string
  timestamp: string
  level: DiagnosticLevel
  area: string
  message: string
  context?: unknown
}

const DIAGNOSTIC_KEY = 'parallax.diagnostics.v1'
const MAX_ENTRIES = 100

export function readDiagnostics(): DiagnosticEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIAGNOSTIC_KEY) ?? '[]') as DiagnosticEntry[]
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : []
  } catch {
    return []
  }
}

export function logDiagnostic(level: DiagnosticLevel, area: string, message: string, context?: unknown) {
  const entry: DiagnosticEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    area,
    message,
    ...(context === undefined ? {} : { context }),
  }
  try {
    localStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify([entry, ...readDiagnostics()].slice(0, MAX_ENTRIES)))
    window.dispatchEvent(new CustomEvent('parallax:diagnostics-changed'))
  } catch {
    // Diagnostics must never interrupt modeling if browser storage is unavailable.
  }
  if (level === 'error') console.error(`[${area}] ${message}`, context ?? '')
  else if (level === 'warning') console.warn(`[${area}] ${message}`, context ?? '')
  else console.info(`[${area}] ${message}`, context ?? '')
  return entry
}

export function clearDiagnostics() {
  localStorage.removeItem(DIAGNOSTIC_KEY)
  window.dispatchEvent(new CustomEvent('parallax:diagnostics-changed'))
}

export function downloadDiagnostics() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries: readDiagnostics() }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `parallax-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
