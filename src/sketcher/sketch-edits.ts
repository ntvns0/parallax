import { useDocumentStore } from '../core/document-store'
import type { SketchConstraint, SketchEntity, SketchFeature, Vec2 } from '../core/model'
import {
  positionSketchEntities,
  resolveSketchAnchor,
  scaleSketchEntities,
  translateSketchEntities,
} from '../core/sketch'
import { solveSketchConstraints } from './constraint-solver'
import { resolveParameterTable, withoutConstraintFormula } from '../core/parameters'
import { tryEvaluateExpression } from '../core/expression'
import { trimSketchEntity } from './trim'
import { filletSketchCorner } from './sketch-fillet'
import { formatLengthInput } from '../core/units'

/**
 * Sketch editing that goes through PlaneGCS.
 *
 * Every entry point here follows the same shape: work out what the user's edit
 * means in terms of *constraints*, hand the whole sketch to the solver, and
 * commit the solved result as one undoable step. Nothing in this module writes
 * geometry the solver has not agreed to, which is what makes a driving
 * dimension actually drive.
 */

function readSketch(sketchId: string): SketchFeature | null {
  const feature = useDocumentStore.getState().document.features.find((candidate) => candidate.id === sketchId)
  return feature?.kind === 'sketch' ? feature : null
}

function entitySignature(entities: SketchEntity[]) {
  return entities.map((entity) => entity.id).join('|')
}

/**
 * Solve and commit, leaving the document untouched if the sketch changed while
 * the worker was busy. A solver failure commits the requested geometry rather
 * than discarding the edit — the solver badge already reports the failure, and
 * silently swallowing a user's input is worse than briefly unsolved geometry.
 */
async function solveAndCommit(
  sketch: SketchFeature,
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  options?: { amend?: boolean },
) {
  const anchor = resolveSketchAnchor(entities, sketch.anchor)
  const requested = entitySignature(entities)
  let solved = entities
  try {
    solved = await solveSketchConstraints(entities, constraints, anchor, { id: sketch.id, name: sketch.name })
  } catch {
    // Keep the requested geometry; useConstraintSolverStore holds the reason.
  }

  const current = readSketch(sketch.id)
  if (!current) return
  const unchanged = options?.amend
    ? entitySignature(current.entities) === requested
    : entitySignature(current.entities) === entitySignature(sketch.entities)
  if (!unchanged) return

  useDocumentStore.getState().commitSketchSolve(sketch.id, solved, constraints, options)
}

/**
 * Add newly drawn geometry. The raw entities land immediately so drawing stays
 * responsive while the WebAssembly solver warms up, then the solved result
 * amends that same undo entry instead of stacking a second one.
 */
export async function applySketchGeometry(sketchId: string, entities: SketchEntity[], constraints: SketchConstraint[]) {
  useDocumentStore.getState().addSketchGeometry(sketchId, entities, constraints)
  const sketch = readSketch(sketchId)
  if (!sketch) return
  await solveAndCommit(sketch, sketch.entities, sketch.constraints, { amend: true })
}

/**
 * The dimensions that govern a sketch's overall size along one axis. A distance
 * on a horizontal line drives width, on a vertical line it drives height, and a
 * circle's radius drives both — but only when no lines are present, so
 * stretching a plate does not quietly resize the holes in it.
 */
function drivingDimensions(sketch: SketchFeature, axis: 0 | 1, targetSize: number) {
  const hasLines = sketch.entities.some((entity) => entity.type === 'line')
  const driving: { id: string; value: number }[] = []

  for (const constraint of sketch.constraints) {
    const entity = sketch.entities.find((candidate) => candidate.id === constraint.entityIds[0])
    if (!entity) continue
    if (constraint.type === 'radius' && entity.type === 'circle' && !hasLines) {
      driving.push({ id: constraint.id, value: targetSize / 2 })
    }
    if (constraint.type === 'distance' && entity.type === 'line') {
      const horizontal = Math.abs(entity.end[1] - entity.start[1]) <= Math.abs(entity.end[0] - entity.start[0])
      if ((axis === 0) === horizontal) driving.push({ id: constraint.id, value: targetSize })
    }
  }
  return driving
}

/**
 * Resize a sketch by editing the dimensions that produce its size, then
 * re-solving. Geometry moves because the constraint changed, not the other way
 * round, so the sketch grows away from its anchor exactly as it will the next
 * time the document is recomputed.
 *
 * Sketches with no dimension on that axis fall back to scaling the geometry and
 * re-solving, which is the best available answer when nothing drives the size.
 */
export async function applySketchResize(sketchId: string, axis: 0 | 1, targetSize: number) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  const size = Math.max(0.001, targetSize)
  const driving = drivingDimensions(sketch, axis, size)

  if (driving.length) {
    const values = new Map(driving.map((dimension) => [dimension.id, dimension.value]))
    const constraints = sketch.constraints.map((constraint) => values.has(constraint.id)
      ? { ...constraint, value: values.get(constraint.id) }
      : constraint)
    await solveAndCommit(sketch, sketch.entities, constraints)
    return
  }

  await solveAndCommit(sketch, scaleSketchEntities(sketch.entities, axis, size), sketch.constraints)
}

/**
 * Retarget one dimension and re-solve.
 *
 * This is the general form of what the width and height fields do for a whole
 * sketch: change the number the constraint asserts and let PlaneGCS work out
 * where the geometry has to go. Any dimension can be edited this way, including
 * ones no overall-size heuristic would ever pick out.
 */
export async function applySketchConstraintValue(sketchId: string, constraintId: string, value: number) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  // A typed number ends the formula that used to supply it — and it has to be
  // dropped here rather than left for the store, because the formula would
  // otherwise be re-evaluated over the top of this value.
  const constraints = sketch.constraints.map((constraint) =>
    constraint.id === constraintId ? { ...withoutConstraintFormula(constraint), value } : constraint)
  await solveAndCommit(sketch, sketch.entities, constraints)
}

/**
 * Drive a sketch dimension by a formula, or clear it with null.
 *
 * The formula is evaluated here and its result committed as the dimension's
 * value, so the solver receives a number exactly as it does for a typed
 * dimension. `core/parameters.ts` keeps that number in step afterwards, whenever
 * anything the formula reads changes.
 */
export async function applySketchConstraintFormula(sketchId: string, constraintId: string, formula: string | null) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  const scope = resolveParameterTable(useDocumentStore.getState().document.parameters ?? []).scope
  let failure: string | null = null
  const constraints = sketch.constraints.map((constraint) => {
    if (constraint.id !== constraintId) return constraint
    if (formula === null) return withoutConstraintFormula(constraint)
    const result = tryEvaluateExpression(formula, scope)
    if (!result.ok) {
      failure = result.error
      return constraint
    }
    return { ...constraint, formula, value: result.value }
  })
  if (failure) return failure
  await solveAndCommit(sketch, sketch.entities, constraints)
  return null
}

/**
 * Trim the piece of a curve the user clicked on.
 *
 * The geometry is worked out by `trim.ts` and then goes through the solver like
 * any other edit, so the trimmed sketch is one the constraints still agree with
 * — and one undo step returns the whole curve.
 */
export async function applySketchTrim(sketchId: string, targetId: string, point: Vec2) {
  const sketch = readSketch(sketchId)
  if (!sketch) return false
  const outcome = trimSketchEntity(sketch.entities, sketch.constraints, targetId, point)
  if (!outcome) return false
  await solveAndCommit(sketch, outcome.entities, outcome.constraints)
  return true
}

/**
 * Round the corner between two selected entities.
 *
 * Returns a message when the fillet cannot be made, so the caller can say why
 * rather than appearing to do nothing; the message quotes the radius that would
 * fit when that was the problem.
 */
export async function applySketchFillet(sketchId: string, firstId: string, secondId: string, radius: number) {
  const sketch = readSketch(sketchId)
  if (!sketch) return 'This sketch is no longer available.'
  const result = filletSketchCorner(sketch.entities, sketch.constraints, firstId, secondId, radius)
  if (!result.ok) {
    return result.maximumRadius === undefined
      ? result.reason
      : `${result.reason} The largest that fits is ${formatLengthInput(result.maximumRadius, useDocumentStore.getState().document.displayUnits ?? 'mm')}.`
  }
  await solveAndCommit(sketch, result.entities, result.constraints)
  return null
}

/**
 * Assert a new relationship between existing geometry and re-solve.
 *
 * The constraint is added before solving, so a request the solver cannot
 * satisfy shows up as a reported conflict naming this constraint rather than
 * disappearing without explanation.
 */
export async function applySketchConstraint(sketchId: string, constraint: SketchConstraint) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  await solveAndCommit(sketch, sketch.entities, [...sketch.constraints, constraint])
}

/** Remove a constraint and re-solve with the freedom it was taking up. */
export async function removeSketchConstraint(sketchId: string, constraintId: string) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  await solveAndCommit(sketch, sketch.entities, sketch.constraints.filter((candidate) => candidate.id !== constraintId))
}

/**
 * Move geometry and re-solve. The anchor travels with the selection whenever it
 * is part of it, so the solver honours the move instead of pulling it back to
 * where the drag started.
 */
export async function applySketchTranslation(sketchId: string, entityIds: Set<string>, delta: Vec2) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  await solveAndCommit(sketch, translateSketchEntities(sketch.entities, entityIds, delta), sketch.constraints)
}

/** Place the centre of a selection at a typed coordinate, then re-solve. */
export async function applySketchPosition(sketchId: string, entityIds: Set<string>, center: Vec2) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  await solveAndCommit(sketch, positionSketchEntities(sketch.entities, entityIds, center), sketch.constraints)
}

/** Move one line endpoint, then let its authored constraints resolve the rest. */
export async function applySketchPointPosition(
  sketchId: string,
  entityId: string,
  pointRef: 'start' | 'end',
  point: Vec2,
) {
  const sketch = readSketch(sketchId)
  if (!sketch) return
  const entities = sketch.entities.map((entity) => entity.id === entityId && entity.type === 'line'
    ? { ...entity, [pointRef]: point }
    : entity)
  await solveAndCommit(sketch, entities, sketch.constraints)
}
