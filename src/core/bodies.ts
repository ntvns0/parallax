import { SOLID_KINDS } from './model'

/**
 * Which body each solid feature builds.
 *
 * A body starts at a `newBody` extrude or revolve, and is named by that
 * feature's id. Every later solid feature changes one body: the one its
 * `bodyId` names, or, without one, the body of the solid feature before it.
 * That default is how a single-body history has always read, so documents
 * from before bodies existed mean what they did.
 *
 * Each body is its own chain of operations: evaluating one never replays
 * another. Generic in the feature type so the render plan can use it on its
 * own slimmer records.
 */

export type BodyMember = {
  id: string
  kind: string
  operation?: 'newBody' | 'add' | 'cut'
  bodyId?: string
}

export type Body = {
  /** The id of the feature that starts the body. */
  id: string
  name: string
  /** Its solid features, in history order, the starting one first. */
  featureIds: string[]
}

function isSolidKind(feature: BodyMember) {
  return (SOLID_KINDS as readonly string[]).includes(feature.kind)
}

/** Whether a feature starts a body of its own rather than changing one. */
export function startsBody(feature: BodyMember): boolean {
  return (feature.kind === 'extrude' || feature.kind === 'revolve') && feature.operation === 'newBody'
}

/** The body each solid feature belongs to, by the id of the feature that started it. */
export function bodyMembership(features: readonly BodyMember[]): Map<string, string> {
  const membership = new Map<string, string>()
  const started = new Set<string>()
  let current: string | null = null
  for (const feature of features) {
    if (!isSolidKind(feature)) continue
    // A history may open on something that is not a new body, a fillet with
    // nothing to round, say. It still starts the first body.
    if (startsBody(feature) || current === null) {
      started.add(feature.id)
      membership.set(feature.id, feature.id)
      current = feature.id
      continue
    }
    // A body named that does not exist yet, or any more, falls back like no name.
    const body: string = feature.bodyId && started.has(feature.bodyId) ? feature.bodyId : current
    membership.set(feature.id, body)
    current = body
  }
  return membership
}

/** The bodies of a history, in the order they were started. */
export function listBodies(features: readonly (BodyMember & { name?: string })[]): Body[] {
  const membership = bodyMembership(features)
  const bodies = new Map<string, Body>()
  for (const feature of features) {
    const body = membership.get(feature.id)
    if (!body) continue
    if (!bodies.has(body)) bodies.set(body, { id: body, name: `Body ${bodies.size + 1}`, featureIds: [] })
    bodies.get(body)!.featureIds.push(feature.id)
  }
  return [...bodies.values()]
}

/** The bodies started before `featureId`: the ones it may change. */
export function bodiesBefore(features: readonly (BodyMember & { name?: string })[], featureId: string): Body[] {
  const index = features.findIndex((feature) => feature.id === featureId)
  return listBodies(features.slice(0, index < 0 ? features.length : index))
}

/**
 * The body a new feature should change, given what it was made from: the body
 * of `sourceId`. Undefined when the part has one body, so single-body
 * documents stay as they were written; the default then does the same thing.
 */
export function bodyToChange(features: readonly (BodyMember & { name?: string })[], sourceId: string | undefined): string | undefined {
  if (!sourceId || listBodies(features).length < 2) return undefined
  return bodyMembership(features).get(sourceId)
}
