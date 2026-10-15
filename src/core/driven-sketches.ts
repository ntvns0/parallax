import type { CadDocument, SketchFeature } from './model'

/**
 * Sketches whose formula-driven dimensions no longer match their geometry.
 *
 * `resolveDocumentFormulas` keeps every dimension's number equal to its
 * formula, but it is synchronous and pure, so it cannot move geometry: that
 * takes PlaneGCS, which lives in a worker. Edits made inside the sketcher solve
 * as they go. A parameter edited anywhere else changes the number and leaves
 * the lines where they were, so the dimension says 60 while the part is still
 * 40 wide. These functions name the sketches that are in that state, so the
 * sketcher can solve them.
 */

function isDriven(sketch: SketchFeature) {
  return sketch.constraints.some((constraint) => constraint.formula !== undefined)
}

function drivenValues(sketch: SketchFeature) {
  return sketch.constraints.filter((constraint) => constraint.formula !== undefined).map((constraint) => `${constraint.id}=${constraint.value}`).join('|')
}

/**
 * The sketches an edit left unsolved: a driven dimension changed value between
 * the two documents while the geometry stayed exactly the same.
 *
 * Geometry that changed as well means something already solved it — the
 * sketcher, or an undo restoring a snapshot that was solved when it was taken.
 */
export function sketchesAwaitingSolve(previous: CadDocument, next: CadDocument): string[] {
  if (previous.id !== next.id) return drivenSketches(next)
  const before = new Map(previous.features.map((feature) => [feature.id, feature]))
  const awaiting: string[] = []
  for (const feature of next.features) {
    if (feature.kind !== 'sketch' || !isDriven(feature)) continue
    const earlier = before.get(feature.id)
    if (earlier?.kind !== 'sketch') continue
    if (drivenValues(earlier) === drivenValues(feature)) continue
    if (JSON.stringify(earlier.entities) !== JSON.stringify(feature.entities)) continue
    awaiting.push(feature.id)
  }
  return awaiting
}

/**
 * Every sketch with a formula-driven dimension.
 *
 * A document that has just been opened has no previous state to compare with,
 * and a file saved before driven sketches were solved may hold a dimension and
 * geometry that disagree, so all of them are solved once.
 */
export function drivenSketches(document: CadDocument): string[] {
  return document.features.filter((feature) => feature.kind === 'sketch' && isDriven(feature)).map((feature) => feature.id)
}
