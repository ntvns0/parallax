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
 *
 * Written out in full on purpose. It once ended in `CURRENT_SCHEMA_VERSION`,
 * so a schema bump silently dropped the previous version and every project
 * saved at it stopped opening. `schema-fixtures.test.ts` checks the list has no
 * gaps and that each version has a saved fixture.
 */
export const MIGRATABLE_SCHEMA_VERSIONS: number[] = [1, 2, 3, 4, 5, 6, 7, 8]

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
 * Give face-attached sketches the anchor they were saved without, and replace
 * one that cannot be right.
 *
 * Before v7 a face sketch had no anchor, and the stored offset still describes
 * the face that produced it, so the sweep end it names can be recovered from
 * the document alone — the same reasoning as the fillet backfill above.
 *
 * Only features *before* the sketch are candidates. A saved face sketch usually
 * has its own cut, which starts exactly on the face and so matches the offset
 * as well; an anchor naming it is circular and never moves with the host.
 * Earlier builds made that mistake, so an anchor naming an extrusion at or
 * after the sketch is derived again on every open rather than trusted.
 */
function migrateFaceAnchors(document: CadDocument): CadDocument {
  return {
    ...document,
    features: document.features.map((feature, index) => {
      if (feature.kind !== 'sketch' || !feature.attachment) return feature
      const earlier = document.features.slice(0, index)
      const current = feature.attachment.anchor
      if (current && earlier.some((candidate) => candidate.id === current.featureId)) return feature
      const anchor = deriveFaceAnchor(feature, earlier)
      if (!anchor && !current) return feature
      const attachment = { ...feature.attachment, anchor }
      if (!anchor) delete attachment.anchor
      return { ...feature, attachment }
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
  const faced = migrateFaceAnchors(edged)
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
