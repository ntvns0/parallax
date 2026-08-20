import { create } from 'zustand'
import type { SketchAnchor, SketchConstraint, SketchEntity } from '../core/model'
import { resolveSketchAnchor } from '../core/sketch'
import type { ConstraintRequest, ConstraintResponse } from './constraint-types'
import { recordFeatureDiagnostics, type FeatureDiagnostic } from '../core/diagnostics'

type SolverState = {
  status: 'idle' | 'loading' | 'solved' | 'error'
  degreesOfFreedom: number | null
  message: string
  /**
   * The constraints PlaneGCS could not satisfy, and the ones it did not need.
   *
   * The solver reports these by id, and those ids are the document's own, so
   * they can be pointed at directly. Reducing them to a count — which is what
   * this store used to keep — throws away the only thing that tells a user
   * *which* dimension to go and fix.
   */
  conflicting: string[]
  redundant: string[]
  /** Constraints the solver could not express, and so never enforced. */
  unsupported: string[]
}

const IDLE = {
  status: 'idle' as const,
  degreesOfFreedom: null,
  message: 'PlaneGCS ready',
  conflicting: [],
  redundant: [],
  unsupported: [],
}

export const useConstraintSolverStore = create<SolverState>(() => IDLE)

let worker: Worker | null = null
let requestId = 0
const pending = new Map<number, { resolve: (entities: SketchEntity[]) => void; reject: (error: Error) => void; owner?: { id: string; name: string } }>()

function getWorker() {
  if (worker) return worker
  useConstraintSolverStore.setState({ ...IDLE, status: 'loading', message: 'Loading PlaneGCS…' })
  worker = new Worker(new URL('./constraint-solver.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<ConstraintResponse>) => {
    const response = event.data
    const handler = pending.get(response.id)
    if (!handler) return
    pending.delete(response.id)
    if (response.ok) {
      const issueCount = response.conflicting.length + response.redundant.length + response.unsupported.length
      useConstraintSolverStore.setState({
        status: issueCount ? 'error' : 'solved',
        degreesOfFreedom: response.degreesOfFreedom,
        message: describeSolution(response),
        conflicting: response.conflicting,
        redundant: response.redundant,
        unsupported: response.unsupported,
      })
      if (handler.owner) recordFeatureDiagnostics([handler.owner.id], constraintFeatureDiagnostics(handler.owner, response))
      handler.resolve(response.entities)
    } else {
      useConstraintSolverStore.setState({ ...IDLE, status: 'error', message: response.error })
      handler.reject(new Error(response.error))
    }
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The sketch solver stopped unexpectedly.')
    for (const handler of pending.values()) handler.reject(error)
    pending.clear()
    useConstraintSolverStore.setState({ status: 'error', degreesOfFreedom: null, message: error.message })
    worker?.terminate()
    worker = null
  }
  return worker
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** A one-line summary of how the sketch solved, for the solver badge. */
function describeSolution(response: Extract<ConstraintResponse, { ok: true }>): string {
  if (response.unsupported.length) return `${plural(response.unsupported.length, 'constraint')} cannot apply to that geometry`
  if (response.conflicting.length) return `${plural(response.conflicting.length, 'conflicting constraint')}`
  if (response.redundant.length) return `${plural(response.redundant.length, 'redundant constraint')}`
  if (response.degreesOfFreedom === 0) return 'Sketch is fully constrained'
  return `${plural(response.degreesOfFreedom, 'degree')} of freedom remain`
}

export function solveSketchConstraints(entities: SketchEntity[], constraints: SketchConstraint[], anchor?: SketchAnchor, owner?: { id: string; name: string }) {
  const id = ++requestId
  const request: ConstraintRequest = { id, entities, constraints, anchor: resolveSketchAnchor(entities, anchor) }
  const result = new Promise<SketchEntity[]>((resolve, reject) => pending.set(id, { resolve, reject, owner }))
  getWorker().postMessage(request)
  return result
}

function constraintFeatureDiagnostics(
  owner: { id: string; name: string },
  response: Extract<ConstraintResponse, { ok: true }>,
): FeatureDiagnostic[] {
  const ids = response.conflicting.length ? response.conflicting : response.redundant.length ? response.redundant : response.unsupported
  if (!ids.length) return []
  const trouble = response.conflicting.length ? 'conflicting' : response.redundant.length ? 'redundant' : 'inapplicable'
  return [{
    featureId: owner.id,
    featureName: owner.name,
    severity: 'warning',
    code: 'constraint-conflict',
    reason: trouble === 'conflicting' ? 'conflicting' : 'invalid',
    subject: { kind: 'constraint', id: ids[0], label: `${ids.length} ${trouble} constraint${ids.length === 1 ? '' : 's'}` },
    message: `${owner.name} has ${ids.length} ${trouble} constraint${ids.length === 1 ? '' : 's'}. Edit or remove the highlighted constraint${ids.length === 1 ? '' : 's'} to restore a clean solve.`,
    repairs: ids.map((constraintId) => ({ kind: 'edit-constraint' as const, label: 'Edit highlighted constraint', constraintId })),
  }]
}
