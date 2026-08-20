export type SketchConstraintState = 'neutral' | 'under-constrained' | 'fully-constrained' | 'over-constrained'

type ConstraintStateInput = {
  status: 'idle' | 'loading' | 'solved' | 'error'
  degreesOfFreedom: number | null
  conflicting: string[]
  redundant: string[]
  unsupported: string[]
}

/** Reduce a solver result to the conventional sketch display state. */
export function sketchConstraintState(result: ConstraintStateInput): SketchConstraintState {
  const hasConstraintIssue = result.conflicting.length > 0
    || result.redundant.length > 0
    || result.unsupported.length > 0

  // Unsupported relationships are warning-red too: the current solve is not
  // honoring a constraint stored in the document.
  if (hasConstraintIssue) return 'over-constrained'
  // Never present stale geometry as constrained while the solver is pending or
  // after an infrastructure failure that did not identify a bad constraint.
  if (result.status !== 'solved' || result.degreesOfFreedom === null) return 'neutral'
  return result.degreesOfFreedom === 0 ? 'fully-constrained' : 'under-constrained'
}
