import { extrudeSweepRange } from './extrude-direction'
import type { ExtrudeFeature, Feature, FaceAnchor, SketchFeature } from './model'
import { ANCHOR_MATCH_DISTANCE_MM } from './tolerance-policy'

/**
 * Anchoring a face-attached sketch to the feature whose sweep made the face.
 *
 * A sketch drawn on a face records the position of that face along its plane's
 * normal, and used to record nothing else. That number is a snapshot: change
 * the depth of the extrusion the face belongs to and the sketch stays where the
 * face *was*, silently detached from the solid it was drawn on and cutting at
 * the wrong depth.
 *
 * An anchor names the sweep end instead — "the far cap of Extrude 1" — so the
 * offset can be worked out again from the current document. Like the edge
 * anchors in `edge-anchor.ts`, deriving and resolving are both pure functions
 * of the document: no solid is needed, which is what lets saved parts gain
 * anchors in a migration rather than having to be rebuilt.
 */

function extrusionsWithSketches(features: Feature[]): { extrude: ExtrudeFeature; sketch: SketchFeature }[] {
  const found: { extrude: ExtrudeFeature; sketch: SketchFeature }[] = []
  for (const feature of features) {
    if (feature.kind !== 'extrude') continue
    const source = features.find((candidate) => candidate.id === feature.sketchId)
    if (source?.kind === 'sketch') found.push({ extrude: feature, sketch: source })
  }
  return found
}

/**
 * The offset a face anchor currently resolves to, or null when the feature it
 * names is gone or no longer produces that face.
 *
 * `seen` breaks a cycle: a sketch on a face of an extrusion built from a sketch
 * on a face of… is legitimate and terminates, but a document edited into a loop
 * would not, and this is called during evaluation.
 */
export function resolveFaceOffset(anchor: FaceAnchor, features: Feature[], seen = new Set<string>()): number | null {
  const extrude = features.find((candidate): candidate is ExtrudeFeature =>
    candidate.kind === 'extrude' && candidate.id === anchor.featureId)
  if (!extrude) return null
  const sketch = features.find((candidate) => candidate.id === extrude.sketchId)
  if (sketch?.kind !== 'sketch') return null

  const range = extrudeSweepRange(extrude, sketch, currentPlaneOffset(sketch, features, seen))
  return range[anchor.depth]
}

/**
 * Where a sketch's plane sits right now: re-derived from its anchor when it has
 * one that still resolves, and the stored offset otherwise.
 *
 * Falling back rather than failing means a sketch whose host was deleted keeps
 * working exactly as it did before anchors existed.
 */
export function currentPlaneOffset(sketch: SketchFeature, features: Feature[], seen = new Set<string>()): number {
  const anchor = sketch.attachment?.anchor
  if (!anchor || seen.has(sketch.id)) return sketch.parameters.planeOffset
  seen.add(sketch.id)
  const resolved = resolveFaceOffset(anchor, features, seen)
  return resolved ?? sketch.parameters.planeOffset
}

/**
 * Work out which sweep end a face-attached sketch is sitting on.
 *
 * Searched newest first: the face a user just clicked belongs to the solid as
 * it stands, so when an older extrusion happens to end at the same height the
 * most recent one is the better answer.
 */
export function deriveFaceAnchor(
  sketch: Pick<SketchFeature, 'plane' | 'parameters'>,
  features: Feature[],
): FaceAnchor | undefined {
  const candidates = extrusionsWithSketches(features).reverse()
  for (const { extrude, sketch: source } of candidates) {
    if (source.plane !== sketch.plane) continue
    const [near, far] = extrudeSweepRange(extrude, source, currentPlaneOffset(source, features))
    if (Math.abs(sketch.parameters.planeOffset - far) <= ANCHOR_MATCH_DISTANCE_MM) {
      return { kind: 'extrudeCap', featureId: extrude.id, depth: 1 }
    }
    if (Math.abs(sketch.parameters.planeOffset - near) <= ANCHOR_MATCH_DISTANCE_MM) {
      return { kind: 'extrudeCap', featureId: extrude.id, depth: 0 }
    }
  }
  return undefined
}
