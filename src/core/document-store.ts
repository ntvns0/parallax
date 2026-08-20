import { create } from 'zustand'
import {
  cloneDocument,
  createEmptyDocument,
  createExtrudeFeature,
  createRevolveFeature,
  createFilletFeature,
  createFeature,
  type CadDocument,
  type DisplayUnits,
  type Feature,
  type FeatureKind,
  type FeatureParameterPatch,
  type FilletEdgeReference,
  type FilletFeature,
  type SketchConstraint,
  type SketchEntity,
  type SketchFaceAttachment,
  type SketchPlane,
  type Vec3,
  type FilletCornerStyle,
  type FilletProfileShape,
  type DocumentParameter,
  createId,
} from './model'
import { renameParameterReferences, resolveDocumentFormulas, withoutConstraintFormula } from './parameters'
import type { FeatureDiagnostic } from './diagnostics'
import { normalizeDocument } from './document-migration'
import { logDiagnostic } from './diagnostics'
import * as storage from './project-storage'
import type { ProjectSummary, RecoverySnapshot } from './project-storage'
import { anchorEdgeReferences } from './edge-anchor'
import { distanceForOperation, isFaceAttached, operationForDistance, sketchForExtrude } from './extrude-direction'
import { resolveSketchAnchor } from './sketch'
import { ProjectPersistenceService, sortProjects, updateProjectList } from './project-persistence'
import { deriveFaceAnchor } from './face-anchor'
import { areDocumentsStructurallyEqual } from './geometry-signature'

const MAX_HISTORY = 100

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'
export type { ProjectSummary, RecoverySnapshot }

type DocumentSnapshot = {
  document: CadDocument
  selectedId: string | null
}

type EditorState = {
  document: CadDocument
  ready: boolean
  selectedId: string | null
  past: DocumentSnapshot[]
  future: DocumentSnapshot[]
  savedAt: string | null
  saveStatus: SaveStatus
  saveError: string | null
  projects: ProjectSummary[]
  recoverySnapshots: RecoverySnapshot[]
  activeSketchId: string | null
  sketchTool: 'select' | 'line' | 'rectangle' | 'circle' | 'arc' | 'three-point-arc' | 'tangent-arc' | 'trim'
  /**
   * Formulas that no longer evaluate, by the feature that holds them.
   *
   * Kept here rather than in `useFeatureDiagnosticsStore` because these are
   * derived from the document on every edit, while that store holds what the
   * evaluators found and is cleared per evaluated feature — writing these there
   * would mean a kernel run silently dropping them.
   */
  formulaDiagnostics: Record<string, FeatureDiagnostic>
  select: (id: string | null) => void
  addFeature: (kind: FeatureKind) => void
  updateFeature: (id: string, patch: Partial<Feature>) => void
  /**
   * Patch a feature's parameters.
   *
   * `amend` writes the change without adding a history entry, so a continuous
   * gesture — dragging a face to a new depth — leaves one undo step covering the
   * whole drag rather than one per frame. The first update of a gesture is a
   * normal one, which records the state to return to; every update after it
   * amends.
   */
  updateParameters: (id: string, parameters: FeatureParameterPatch, options?: { amend?: boolean }) => void
  setFeaturePosition: (id: string, position: Vec3) => void
  toggleFeatureVisibility: (id: string) => void
  renameDocument: (name: string) => void
  setDisplayUnits: (units: DisplayUnits) => void
  removeSelected: () => void
  undo: () => void
  redo: () => void
  hydrate: () => Promise<void>
  save: () => Promise<void>
  newDocument: () => Promise<void>
  openDocument: (id: string) => Promise<void>
  deleteDocument: (id: string) => Promise<void>
  importDocument: (document: CadDocument) => Promise<void>
  restoreRecoverySnapshot: (snapshotId: string) => void
  beginSketch: (id?: string, plane?: SketchPlane, planeOffset?: number, faceNormalSign?: -1 | 1, attachment?: SketchFaceAttachment) => void
  finishSketch: () => void
  setSketchTool: (tool: EditorState['sketchTool']) => void
  addSketchGeometry: (sketchId: string, entities: SketchEntity[], constraints: SketchConstraint[]) => void
  replaceSketchEntities: (sketchId: string, entities: SketchEntity[]) => void
  commitSketchSolve: (sketchId: string, entities: SketchEntity[], constraints?: SketchConstraint[], options?: { amend?: boolean }) => void
  deleteSketchEntity: (sketchId: string, entityId: string) => void
  deleteSketchConstraint: (sketchId: string, constraintId: string) => void
  setSketchConstraintValue: (sketchId: string, constraintId: string, value: number) => void
  /** Drive a dimension by a formula, or clear it with null and keep the number. */
  setSketchConstraintFormula: (sketchId: string, constraintId: string, formula: string | null) => void
  addParameter: (parameter?: Partial<DocumentParameter>) => string
  updateParameter: (id: string, patch: Partial<Omit<DocumentParameter, 'id'>>) => void
  removeParameter: (id: string) => void
  /** Drive a feature parameter by a formula, or clear it with null and keep the number. */
  setFeatureFormula: (featureId: string, key: string, formula: string | null) => void
  extrudeSketch: (sketchId: string, distance?: number) => void
  revolveSketch: (sketchId: string, angle?: number) => void
  addFillet: (feature: FilletFeature) => void
}

const persistenceService = new ProjectPersistenceService()

export function prepareFilletFeature(
  edges: FilletEdgeReference[],
  radius: number,
  features: Feature[],
  options?: { cornerStyle?: FilletCornerStyle; filletShape?: FilletProfileShape; radius2?: number },
) {
  const anchored = anchorEdgeReferences(edges, features)
  return createFilletFeature(anchored, features.filter((item) => item.kind === 'fillet').length + 1, radius, options)
}

function storageFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  logDiagnostic('error', 'Project storage', message)
  return { saveStatus: 'error' as SaveStatus, saveError: message }
}

function snapshot(state: Pick<EditorState, 'document' | 'selectedId'>): DocumentSnapshot {
  return { document: cloneDocument(state.document), selectedId: state.selectedId }
}

/**
 * Bring formula-driven numbers up to date, and report the formulas that failed.
 *
 * Every edit ends here, which is what keeps the invariant cheap to trust: no
 * caller has to remember that a parameter it changed might drive a number
 * somewhere else in the document.
 */
function resolved(document: CadDocument): { document: CadDocument; formulaDiagnostics: Record<string, FeatureDiagnostic> } {
  const { document: next, diagnostics } = resolveDocumentFormulas(document)
  return {
    document: next,
    formulaDiagnostics: Object.fromEntries(diagnostics.map((diagnostic) => [diagnostic.featureId, diagnostic])),
  }
}

function mutate(
  state: EditorState,
  recipe: (document: CadDocument) => void,
  selectedId = state.selectedId,
): Partial<EditorState> {
  const draft = cloneDocument(state.document)
  recipe(draft)
  draft.updatedAt = new Date().toISOString()
  return {
    ...resolved(draft),
    selectedId,
    past: [...state.past.slice(-(MAX_HISTORY - 1)), snapshot(state)],
    future: [],
    saveStatus: 'unsaved',
    saveError: null,
  }
}

export const useDocumentStore = create<EditorState>((set, get) => ({
  document: createEmptyDocument(),
  ready: false,
  selectedId: null,
  past: [],
  future: [],
  savedAt: null,
  saveStatus: 'saved',
  saveError: null,
  projects: [],
  recoverySnapshots: [],
  activeSketchId: null,
  sketchTool: 'rectangle',
  formulaDiagnostics: {},

  select: (selectedId) => set({ selectedId }),

  addFeature: (kind) =>
    set((state) => {
      const feature = createFeature(kind, state.document.features.length + 1)
      return mutate(state, (document) => document.features.push(feature), feature.id)
    }),

  updateFeature: (id, patch) =>
    set((state) =>
      mutate(state, (document) => {
        const index = document.features.findIndex((feature) => feature.id === id)
        if (index < 0) return
        const updated = { ...document.features[index], ...patch } as Feature
        if (updated.kind === 'extrude' && 'operation' in patch && isFaceAttached(sketchForExtrude(updated, document.features))) {
          updated.parameters = {
            ...updated.parameters,
            distance: distanceForOperation(updated.parameters.distance, updated.operation),
          }
        }
        document.features[index] = updated
      }),
    ),

  updateParameters: (id, parameters, options) =>
    set((state) => {
      const apply = (document: CadDocument) => {
        const feature = document.features.find((candidate) => candidate.id === id)
        if (!feature) return
        feature.parameters = { ...feature.parameters, ...parameters } as Feature['parameters']
        // Writing a number by hand — typing it, or dragging a face — is a
        // decision to stop deriving that field. Leaving the formula in place
        // would silently undo the edit on the next resolve.
        if (feature.formulas) {
          for (const key of Object.keys(parameters)) delete feature.formulas[key]
          if (!Object.keys(feature.formulas).length) delete feature.formulas
        }
        if (feature.kind === 'extrude' && parameters.distance !== undefined && isFaceAttached(sketchForExtrude(feature, document.features))) {
          feature.operation = operationForDistance(feature.parameters.distance, feature.operation)
        }
      }
      if (!options?.amend) return mutate(state, apply)
      const draft = cloneDocument(state.document)
      apply(draft)
      draft.updatedAt = new Date().toISOString()
      return { ...resolved(draft), saveStatus: 'unsaved', saveError: null }
    }),

  setFeaturePosition: (id, position) =>
    set((state) =>
      mutate(state, (document) => {
        const feature = document.features.find((candidate) => candidate.id === id)
        if (feature) feature.position = position
      }),
    ),

  toggleFeatureVisibility: (id) =>
    set((state) =>
      mutate(state, (document) => {
        const feature = document.features.find((candidate) => candidate.id === id)
        if (feature) feature.visible = !feature.visible
      }),
    ),

  renameDocument: (name) => set((state) => mutate(state, (document) => { document.name = name })),

  setDisplayUnits: (displayUnits) => set((state) => mutate(state, (document) => { document.displayUnits = displayUnits })),

  removeSelected: () =>
    set((state) => {
      if (!state.selectedId) return state
      return mutate(
        state,
        (document) => {
          const deleting = document.features.find((feature) => feature.id === state.selectedId)
          if (!deleting) return
          if (deleting.kind === 'sketch') {
            document.features = document.features.filter((feature) => feature.id !== deleting.id && !(feature.kind === 'extrude' && feature.sketchId === deleting.id))
          } else {
            document.features = document.features.filter((feature) => feature.id !== deleting.id)
            if (deleting.kind === 'extrude') {
              const source = document.features.find((feature) => feature.id === deleting.sketchId)
              if (source) source.visible = true
            }
          }
        },
        null,
      )
    }),

  undo: () =>
    set((state) => {
      const previous = state.past.at(-1)
      if (!previous) return state
      return {
        document: cloneDocument(previous.document),
        selectedId: previous.selectedId,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, MAX_HISTORY),
        saveStatus: 'unsaved',
        saveError: null,
      }
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0]
      if (!next) return state
      return {
        document: cloneDocument(next.document),
        selectedId: next.selectedId,
        past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
        future: state.future.slice(1),
        saveStatus: 'unsaved',
        saveError: null,
      }
    }),

  hydrate: async () => {
    if (get().ready) return
    try {
      const migration = await storage.migrateLegacyStorage()
      if (migration.migratedProjects) {
        logDiagnostic('info', 'Project storage', `Moved ${migration.migratedProjects} project(s) and ${migration.migratedSnapshots} recovery snapshot(s) from browser local storage into IndexedDB.`)
      }

      const workspace = await storage.readWorkspace()
      const candidates = workspace
        ? [workspace.activeDocumentId, ...workspace.projects.map((project) => project.id)]
        : []
      let document: CadDocument | null = null
      for (const id of candidates) {
        document = await storage.readDocument(id)
        if (document) break
      }

      if (!document) {
        const created = createEmptyDocument()
        const projects = await persistenceService.persistDocument(created, workspace?.projects ?? [], false)
        set({ document: created, projects, ready: true, savedAt: created.updatedAt, saveStatus: 'saved' })
        return
      }

      set({
        ...resolved(document),
        projects: updateProjectList(workspace?.projects ?? [], document),
        recoverySnapshots: await storage.readRecoverySnapshots(document.id),
        savedAt: document.updatedAt,
        saveStatus: 'saved',
        ready: true,
      })
    } catch (error) {
      set({ ...storageFailure(error), ready: true })
    }
  },

  save: async () => {
    const state = get()
    if (!state.ready) return
    set({ saveStatus: 'saving', saveError: null })
    try {
      const projects = await persistenceService.persistDocument(state.document, state.projects)
      set({
        projects,
        recoverySnapshots: await storage.readRecoverySnapshots(state.document.id),
        savedAt: new Date().toISOString(),
        saveStatus: 'saved',
      })
    } catch (error) {
      set(storageFailure(error))
    }
  },

  newDocument: async () => {
    const state = get()
    try {
      const savedProjects = await persistenceService.persistDocument(state.document, state.projects)
      const document = createEmptyDocument()
      const projects = await persistenceService.persistDocument(document, savedProjects, false)
      set({
        document,
        formulaDiagnostics: {},
        projects,
        selectedId: null,
        past: [],
        future: [],
        savedAt: document.updatedAt,
        saveStatus: 'saved',
        saveError: null,
        recoverySnapshots: [],
        activeSketchId: null,
      })
    } catch (error) {
      set(storageFailure(error))
    }
  },

  openDocument: async (id) => {
    const state = get()
    try {
      const savedProjects = await persistenceService.persistDocument(state.document, state.projects)
      const document = await storage.readDocument(id)
      if (!document) throw new Error('This project could not be opened.')
      const projects = updateProjectList(savedProjects, document)
      await storage.writeWorkspace({ schemaVersion: 1, activeDocumentId: document.id, projects: sortProjects(projects) })
      set({
        ...resolved(document),
        projects,
        selectedId: null,
        past: [],
        future: [],
        savedAt: document.updatedAt,
        saveStatus: 'saved',
        saveError: null,
        recoverySnapshots: await storage.readRecoverySnapshots(document.id),
        activeSketchId: null,
      })
    } catch (error) {
      set(storageFailure(error))
    }
  },

  deleteDocument: async (id) => {
    const state = get()
    if (id === state.document.id) return
    try {
      await storage.removeDocument(id)
      const projects = state.projects.filter((project) => project.id !== id)
      await storage.writeWorkspace({ schemaVersion: 1, activeDocumentId: state.document.id, projects: sortProjects(projects) })
      set({ projects })
    } catch (error) {
      set(storageFailure(error))
    }
  },

  importDocument: async (document) => {
    const state = get()
    try {
      const savedProjects = await persistenceService.persistDocument(state.document, state.projects)
      const existing = savedProjects.some((project) => project.id === document.id)
      const imported = normalizeDocument(cloneDocument(document))
      if (existing) imported.id = crypto.randomUUID()
      imported.updatedAt = new Date().toISOString()
      const projects = await persistenceService.persistDocument(imported, savedProjects, false)
      set({
        ...resolved(imported),
        projects,
        selectedId: null,
        past: [],
        future: [],
        savedAt: imported.updatedAt,
        saveStatus: 'saved',
        saveError: null,
        recoverySnapshots: [],
        activeSketchId: null,
      })
    } catch (error) {
      set(storageFailure(error))
    }
  },

  restoreRecoverySnapshot: (snapshotId) =>
    set((state) => {
      const recovery = state.recoverySnapshots.find((item) => item.id === snapshotId)
      if (!recovery) return state
      const restored = cloneDocument(recovery.document)
      restored.updatedAt = new Date().toISOString()
      return {
        ...mutate(state, (document) => Object.assign(document, restored), null),
        activeSketchId: null,
      }
    }),

  beginSketch: (id, plane = 'XY', planeOffset = 0, faceNormalSign, attachment) =>
    set((state) => {
      if (id) return { activeSketchId: id, selectedId: id }
      const feature = createFeature('sketch', state.document.features.filter((item) => item.kind === 'sketch').length + 1, plane)
      if (feature.kind !== 'sketch') return state
      feature.parameters.planeOffset = planeOffset
      feature.parameters.faceNormalSign = faceNormalSign
      // Record which sweep end this face is, so the sketch follows the feature
      // under it rather than staying at the height that feature happened to
      // reach when it was picked.
      feature.attachment = attachment && {
        ...attachment,
        anchor: deriveFaceAnchor(feature, state.document.features),
      }
      return { ...mutate(state, (document) => document.features.push(feature), feature.id), activeSketchId: feature.id }
    }),

  finishSketch: () => set((state) => ({ activeSketchId: null, selectedId: state.activeSketchId })),

  setSketchTool: (sketchTool) => set({ sketchTool }),

  addSketchGeometry: (sketchId, entities, constraints) =>
    set((state) => mutate(state, (document) => {
      const sketch = document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch')
      if (sketch?.kind === 'sketch') {
        sketch.entities.push(...entities)
        sketch.constraints.push(...constraints)
        sketch.anchor = resolveSketchAnchor(sketch.entities, sketch.anchor)
      }
    }, sketchId)),

  replaceSketchEntities: (sketchId, entities) =>
    set((state) => mutate(state, (document) => {
      const sketch = document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch')
      if (sketch?.kind !== 'sketch') return
      sketch.entities = entities
      sketch.anchor = resolveSketchAnchor(entities, sketch.anchor)
    }, sketchId)),

  commitSketchSolve: (sketchId, entities, constraints, options) =>
    set((state) => {
      const apply = (document: CadDocument) => {
        const sketch = document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch')
        if (sketch?.kind !== 'sketch') return
        sketch.entities = entities
        if (constraints) sketch.constraints = constraints
        sketch.anchor = resolveSketchAnchor(entities, sketch.anchor)
      }
      if (!options?.amend) return mutate(state, apply, sketchId)
      const draft = cloneDocument(state.document)
      apply(draft)
      draft.updatedAt = new Date().toISOString()
      return { ...resolved(draft), saveStatus: 'unsaved', saveError: null }
    }),

  deleteSketchEntity: (sketchId, entityId) =>
    set((state) => mutate(state, (document) => {
      const sketch = document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch')
      if (sketch?.kind !== 'sketch') return
      sketch.entities = sketch.entities.filter((entity) => entity.id !== entityId)
      sketch.constraints = sketch.constraints.filter((constraint) => !constraint.entityIds.includes(entityId))
      sketch.anchor = resolveSketchAnchor(sketch.entities, sketch.anchor)
    }, sketchId)),

  deleteSketchConstraint: (sketchId, constraintId) =>
    set((state) => mutate(state, (document) => {
      const sketch = document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch')
      if (sketch?.kind !== 'sketch') return
      sketch.constraints = sketch.constraints.filter((constraint) => constraint.id !== constraintId)
    }, sketchId)),

  // Retargets a dimension. The geometry is not touched here: the caller
  // re-solves and commits whatever PlaneGCS makes of the new value, so the
  // sketch moves the way its other constraints say it should.
  setSketchConstraintValue: (sketchId, constraintId, value) =>
    set((state) => mutate(state, (document) => {
      const sketch = document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch')
      if (sketch?.kind !== 'sketch') return
      // Same rule as a feature parameter: a typed number replaces the formula
      // that used to supply it.
      sketch.constraints = sketch.constraints.map((constraint) =>
        constraint.id === constraintId ? { ...withoutConstraintFormula(constraint), value } : constraint)
    }, sketchId)),

  setSketchConstraintFormula: (sketchId, constraintId, formula) =>
    set((state) => mutate(state, (document) => {
      const sketch = document.features.find((feature) => feature.id === sketchId && feature.kind === 'sketch')
      if (sketch?.kind !== 'sketch') return
      sketch.constraints = sketch.constraints.map((constraint) => {
        if (constraint.id !== constraintId) return constraint
        return formula === null ? withoutConstraintFormula(constraint) : { ...constraint, formula }
      })
    }, sketchId)),

  addParameter: (parameter) => {
    const id = parameter?.id ?? createId()
    set((state) => {
      const existing = state.document.parameters ?? []
      // A fresh row needs a name that is free, so the table stays evaluable
      // while the user is still typing over the placeholder.
      let index = existing.length + 1
      while (existing.some((candidate) => candidate.name === `parameter${index}`)) index += 1
      return mutate(state, (document) => {
        document.parameters = [
          ...(document.parameters ?? []),
          { id, name: parameter?.name ?? `parameter${index}`, expression: parameter?.expression ?? '0', ...(parameter?.comment ? { comment: parameter.comment } : {}) },
        ]
      })
    })
    return id
  },

  updateParameter: (id, patch) =>
    set((state) => {
      const existing = (state.document.parameters ?? []).find((parameter) => parameter.id === id)
      if (!existing) return state
      return mutate(state, (document) => {
        // A rename is a document-wide edit: every formula that reads the old
        // name is rewritten in the same undo step, so a rename can never quietly
        // strand the formulas that depend on it.
        const renamed = patch.name !== undefined && patch.name !== existing.name
          ? renameParameterReferences(document, existing.name, patch.name)
          : document
        Object.assign(document, renamed)
        document.parameters = (document.parameters ?? []).map((parameter) =>
          parameter.id === id ? { ...parameter, ...patch } : parameter)
      })
    }),

  removeParameter: (id) =>
    set((state) => mutate(state, (document) => {
      // Formulas that read the deleted name are left as written. They keep their
      // last value and report themselves, which is recoverable; rewriting them
      // to a literal would destroy the design intent the user expressed.
      document.parameters = (document.parameters ?? []).filter((parameter) => parameter.id !== id)
    })),

  setFeatureFormula: (featureId, key, formula) =>
    set((state) => mutate(state, (document) => {
      const feature = document.features.find((candidate) => candidate.id === featureId)
      if (!feature) return
      if (formula === null) {
        if (!feature.formulas) return
        delete feature.formulas[key]
        if (!Object.keys(feature.formulas).length) delete feature.formulas
        return
      }
      feature.formulas = { ...feature.formulas, [key]: formula }
    }, featureId)),

  extrudeSketch: (sketchId, distance) =>
    set((state) => {
      const sketch = state.document.features.find((item) => item.id === sketchId && item.kind === 'sketch')
      const defaultDistance = 25
      const feature = createExtrudeFeature(sketchId, state.document.features.filter((item) => item.kind === 'extrude').length + 1, distance ?? defaultDistance)
      if (sketch?.kind === 'sketch' && sketch.parameters.faceNormalSign) {
        feature.operation = operationForDistance(feature.parameters.distance, 'add')
      }
      return mutate(state, (document) => {
        document.features.push(feature)
        const sketch = document.features.find((item) => item.id === sketchId)
        if (sketch) sketch.visible = false
      }, feature.id)
    }),

  revolveSketch: (sketchId, angle = 360) =>
    set((state) => {
      const feature = createRevolveFeature(sketchId, state.document.features.filter((item) => item.kind === 'revolve').length + 1, angle)
      return mutate(state, (document) => {
        document.features.push(feature)
        const sketch = document.features.find((item) => item.id === sketchId)
        if (sketch) sketch.visible = false
      }, feature.id)
    }),

  addFillet: (feature) =>
    set((state) => {
      if (!feature.edges.length) return state
      return mutate(state, (document) => document.features.push(feature), feature.id)
    }),
}))

let saveTimer: ReturnType<typeof setTimeout> | undefined
useDocumentStore.subscribe((state, previous) => {
  if (!state.ready || state.document === previous.document || state.saveStatus !== 'unsaved') return
  if (areDocumentsStructurallyEqual(state.document, previous.document)) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void useDocumentStore.getState().save(), 700)
})
