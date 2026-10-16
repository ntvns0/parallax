import { bodyMembership, startsBody } from '../core/bodies'
import { modifiesPreviousSolid, SOLID_KINDS, type SolidFeature } from '../core/model'

/**
 * Which solid features the viewport draws, and which earlier meshes each one
 * replaces once its exact result comes back from OpenCascade.
 *
 * Sweeps and fillets are not independent objects: a run of them starting at a
 * `newBody` extrude or revolve describes one body, and every feature in that run
 * renders the *same* body at a different stage of completion. Only the last one
 * is the finished part. The earlier ones are drawn as fallbacks so a slow or failing
 * kernel never blanks the viewport, and they are torn down as soon as a later
 * stage produces real geometry.
 *
 * Getting the teardown wrong is invisible rather than loud: a stale fallback is
 * the same body at the same place, so it sits exactly on top of the finished one
 * and silently hides whatever the last feature did. That is what this module
 * exists to pin down.
 */


/** The parts of a feature that decide how it is rendered. */
export type RenderPlanFeature = {
  id: string
  kind: string
  visible: boolean
  operation?: 'newBody' | 'add' | 'cut'
  bodyId?: string
}

export type RenderPlan = {
  /** Feature ids that get a mesh, in document order. */
  rendered: Set<string>
  /**
   * For each rendered feature, the earlier rendered features describing the same
   * body. They are removed only once this feature's exact result arrives.
   */
  supersedes: Map<string, string[]>
}

/** The feature kinds that produce a solid the viewport draws. */
export type SolidKind = SolidFeature['kind']

/**
 * Generic in the feature type so the viewport can narrow a real `Feature` with
 * the same predicate the plan uses, rather than repeating the list of solid
 * kinds and letting the two drift apart — which is how revolve came to be
 * missing here in the first place.
 */
export function isSolid<T extends RenderPlanFeature>(feature: T): feature is T & { kind: SolidKind } {
  return (SOLID_KINDS as readonly string[]).includes(feature.kind)
}

export function planSolidRender(features: RenderPlanFeature[]): RenderPlan {
  // Bodies are worked out from every feature, hidden ones included, so hiding
  // one does not move the features after it into another body.
  const bodyOf = bodyMembership(features)
  const solids = features.filter((feature) => feature.visible && isSolid(feature))

  // Render only the final stage of each body, plus its immediate predecessor
  // while an exact-only fillet evaluates. Rendering every historical fillet
  // asks the worker to replay prefixes of length 1, 2, 3... after a cold edit,
  // turning one body rebuild into quadratic OpenCascade work.
  const rendered = new Set<string>()
  const bodies = new Map<string, RenderPlanFeature[]>()
  solids.forEach((feature) => bodies.set(bodyOf.get(feature.id)!, [...(bodies.get(bodyOf.get(feature.id)!) ?? []), feature]))
  for (const stages of bodies.values()) {
    const final = stages.at(-1)
    if (!final) continue
    if (modifiesPreviousSolid(final) && stages.length > 1) rendered.add(stages.at(-2)!.id)
    rendered.add(final.id)
  }

  // Every rendered feature replaces the earlier rendered stages of its own body.
  // A `newBody` extrude is the first stage of its body, so it replaces nothing —
  // in particular it must never delete the body before it.
  const supersedes = new Map<string, string[]>()
  const renderedSolids = solids.filter((feature) => rendered.has(feature.id))
  renderedSolids.forEach((feature, index) => {
    if (startsBody(feature) || bodyOf.get(feature.id) === feature.id) {
      supersedes.set(feature.id, [])
      return
    }
    const earlier = renderedSolids
      .slice(0, index)
      .filter((candidate) => bodyOf.get(candidate.id) === bodyOf.get(feature.id))
      .map((candidate) => candidate.id)
    supersedes.set(feature.id, earlier)
  })

  return { rendered, supersedes }
}
