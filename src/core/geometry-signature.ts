import type { CadDocument, Feature, FilletEdgeReference, SketchConstraint, SketchEntity } from './model'

/**
 * A content signature used to answer one question: has anything about this
 * document that a user would want saved actually changed?
 *
 * Two rules keep it honest. It covers *geometry*, not counts — an edit that
 * moves a point or retargets a dimension changes the same number of entities it
 * started with, so hashing lengths would call the result unchanged. And it
 * deliberately excludes `updatedAt`, which `mutate` stamps on every edit: a
 * signature carrying it can never report two documents as equal, which would
 * make the comparison a tautology and every caller a no-op.
 */

function numbers(values: readonly number[]): string {
  return values.join(',')
}

function entitySignature(entity: SketchEntity): string {
  if (entity.type === 'circle') {
    return `c:${entity.id}:${numbers(entity.center)}:${entity.radius}:${entity.construction}`
  }
  if (entity.type === 'arc') {
    return `a:${entity.id}:${numbers(entity.center)}:${entity.radius}:${entity.startAngle}:${entity.endAngle}:${entity.construction}`
  }
  return `l:${entity.id}:${numbers(entity.start)}:${numbers(entity.end)}:${entity.construction}`
}

function constraintSignature(constraint: SketchConstraint): string {
  return [
    constraint.id,
    constraint.type,
    constraint.entityIds.join('+'),
    constraint.pointRefs?.join('+') ?? '',
    constraint.value ?? '',
  ].join(':')
}

function edgeSignature(edge: FilletEdgeReference): string {
  const anchor = edge.anchor
    ? edge.anchor.kind === 'profileSweep'
      ? `sweep:${edge.anchor.sketchId}:${edge.anchor.entityId}:${edge.anchor.depth}`
      : `lateral:${edge.anchor.sketchId}:${edge.anchor.entityId}:${edge.anchor.t}`
    : ''
  return `${numbers(edge.point)}|${numbers(edge.start)}|${numbers(edge.end)}|${anchor}`
}

function featureSignature(feature: Feature): string {
  const base = `${feature.id}:${feature.kind}:${feature.name}:${feature.visible}:${numbers(feature.position)}:${numbers(feature.rotation)}:${JSON.stringify(feature.parameters)}`
  if (feature.kind === 'sketch') {
    const anchor = feature.anchor ? `${feature.anchor.entityId}@${feature.anchor.point}` : ''
    return [
      base,
      feature.plane,
      anchor,
      feature.attachment ? JSON.stringify(feature.attachment) : '',
      feature.entities.map(entitySignature).join(';'),
      feature.constraints.map(constraintSignature).join(';'),
    ].join(':')
  }
  if (feature.kind === 'extrude' || feature.kind === 'revolve') {
    return `${base}:${feature.sketchId}:${feature.operation}`
  }
  if (feature.kind === 'fillet') {
    return `${base}:${feature.edges.map(edgeSignature).join(';')}`
  }
  return base
}

/**
 * A deterministic content signature for an entire document, for fast change
 * detection instead of whole-document JSON serialization.
 */
export function computeDocumentSignature(doc: CadDocument): string {
  const featureSigs = doc.features.map(featureSignature).join('|')
  return `v${doc.schemaVersion}:${doc.id}:${doc.name}:${doc.displayUnits}:${featureSigs}`
}

/**
 * Whether two documents hold the same content. Documents differing only in when
 * they were last touched are equal, which is what lets callers skip redundant
 * saves and recovery snapshots.
 */
export function areDocumentsStructurallyEqual(a: CadDocument, b: CadDocument): boolean {
  if (a.id !== b.id || a.features.length !== b.features.length || a.displayUnits !== b.displayUnits) {
    return false
  }
  return computeDocumentSignature(a) === computeDocumentSignature(b)
}
