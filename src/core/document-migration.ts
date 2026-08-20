import { anchorEdgeReferences } from './edge-anchor'
import { deriveFaceAnchor } from './face-anchor'
import { CURRENT_SCHEMA_VERSION, validateCadDocument, type CadDocument } from './model'
import { resolveDocumentFormulas } from './parameters'
import { resolveSketchAnchor } from './sketch'

/**
 * Schema versions this build can open. v1 predates display units and extrude
 * operations, v2 predates the solver anchor, v4 and earlier stored
 * face-attached cut distances as positive magnitudes, v5 predates fillet edge
 * anchors, v6 predates face anchors, and v7 predates named parameters and
 * formulas.
 *
 * Adding a version that needs more than defaults means adding a step here
 * rather than widening this list.
 */
export const MIGRATABLE_SCHEMA_VERSIONS: number[] = [1, 2, 3, 4, 5, 6, 7, CURRENT_SCHEMA_VERSION]

/**
 * Before v5, a face-attached extrusion stored a positive distance and let the
 * boolean decide the direction: `cut` was flipped to point into the solid when
 * the feature was evaluated. Now the distance carries that sign itself, so a
 * stored cut has to be turned inward once, on open, or every old pocket would
 * reopen as a boss.
 */
function migrateFaceAttachedCutDirection(document: CadDocument): CadDocument {
  return {
    ...document,
    features: document.features.map((feature) => {
      if (feature.kind !== 'extrude' || feature.operation !== 'cut') return feature
      const sketch = document.features.find((candidate) => candidate.id === feature.sketchId)
      if (sketch?.kind !== 'sketch' || !sketch.parameters.faceNormalSign) return feature
      return { ...feature, parameters: { ...feature.parameters, distance: -Math.abs(feature.parameters.distance) } }
    }),
  }
}

/**
 * Give fillets saved before v6 the anchors they were created without.
 *
 * A stored part was saved in a working state, so its recorded coordinates still
 * describe the geometry that produced them, and the anchor can be worked out
 * from the document alone — no solid required. Doing this on open means
 * existing parts survive their next edit, rather than only parts built from
 * here on.
 */
function migrateFilletEdgeAnchors(document: CadDocument): CadDocument {
  return {
    ...document,
    features: document.features.map((feature) => {
      if (feature.kind !== 'fillet') return feature
      return { ...feature, edges: anchorEdgeReferences(feature.edges, document.features) }
    }),
  }
}

/**
 * Give face-attached sketches saved before v7 the anchor they were created
 * without, on the same reasoning as the fillet backfill above: the stored
 * offset still describes the face that produced it, so the sweep end it names
 * can be recovered from the document alone.
 */
function migrateFaceAnchors(document: CadDocument): CadDocument {
  return {
    ...document,
    features: document.features.map((feature) => {
      if (feature.kind !== 'sketch' || !feature.attachment || feature.attachment.anchor) return feature
      const anchor = deriveFaceAnchor(feature, document.features)
      return anchor ? { ...feature, attachment: { ...feature.attachment, anchor } } : feature
    }),
  }
}

export function normalizeDocument(document: CadDocument): CadDocument {
  const defaulted: CadDocument = {
    ...document,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    displayUnits: document.displayUnits ?? 'mm',
    parameters: document.parameters ?? [],
    features: document.features.map((feature) => {
      if (feature.kind === 'extrude') {
        return {
          ...feature,
          operation: feature.operation ?? 'newBody',
          parameters: { ...feature.parameters, edgeRadius: feature.parameters.edgeRadius ?? 0 },
        }
      }
      if (feature.kind === 'sketch') {
        return { ...feature, anchor: resolveSketchAnchor(feature.entities, feature.anchor) }
      }
      return feature
    }),
  }
  const directed = document.schemaVersion < 5 ? migrateFaceAttachedCutDirection(defaulted) : defaulted
  // Anchoring must run after the direction migration, because an anchor is
  // derived against the sweep range and that depends on the corrected sign.
  const edged = document.schemaVersion < 6 ? migrateFilletEdgeAnchors(directed) : directed
  const faced = document.schemaVersion < 7 ? migrateFaceAnchors(edged) : edged
  // A parameter's value is derived, never stored, so it is recomputed on open
  // rather than trusted from the file. A formula that no longer evaluates leaves
  // the last good number in place and reports itself once the UI subscribes.
  return resolveDocumentFormulas(faced).document
}

/**
 * Bring a stored value up to the current schema, or return null if it is not a
 * Parallax document this build can open. Normalization runs before validation
 * because validation requires the defaults migration supplies — a sketch
 * anchor, for one, has to point at real geometry.
 */
export function migrateStoredDocument(value: unknown): CadDocument | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as CadDocument
  if (!Array.isArray(parsed.features) || typeof parsed.id !== 'string') return null
  if (!MIGRATABLE_SCHEMA_VERSIONS.includes(parsed.schemaVersion)) return null
  const migrated = normalizeDocument(parsed)
  return validateCadDocument(migrated).valid ? migrated : null
}

/** Parse and migrate a JSON payload, tolerating anything unparseable. */
export function parseStoredDocument(raw: string | null): CadDocument | null {
  if (!raw) return null
  try {
    return migrateStoredDocument(JSON.parse(raw))
  } catch {
    return null
  }
}
