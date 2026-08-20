export type Vec3 = [number, number, number]
export type Vec2 = [number, number]
export type SketchPlane = 'XY' | 'XZ' | 'YZ'
export type DisplayUnits = 'mm' | 'in-decimal' | 'in-fractional'

export type BoxParameters = {
  width: number
  depth: number
  height: number
}

export type CylinderParameters = {
  radius: number
  height: number
}

export type SphereParameters = {
  radius: number
}

export type SketchParameters = { planeOffset: number; faceNormalSign?: -1 | 1 }
export type ExtrudeParameters = { distance: number; symmetric: boolean; edgeRadius: number }
export type RevolveParameters = { angle: number; axis: 'X' | 'Y' }

/**
 * What made an edge, so it can be found again after the design changes.
 *
 * Absolute coordinates only say where an edge *was*. Move the pocket and every
 * reference to it points at empty space. An anchor instead names the sketch
 * geometry that swept the edge, and because sketch entity ids survive moves,
 * resizes and solver runs, it still resolves once that geometry has moved.
 *
 * Extruding a closed profile produces exactly two kinds of edge, and this is
 * the union of them. It is a tagged union rather than a flat record so that
 * edges created by other features — a fillet's own tangent boundaries, say —
 * can be added as a further variant without disturbing these two.
 */
type EdgeAnchorBase = {
  sketchId: string
  entityId: string
  /**
   * The extrusion that swept the edge.
   *
   * Optional because anchors written before this existed did not record it, and
   * those fall back to the first extrusion built from the sketch — which is the
   * only candidate in the ordinary case, and a guess when a sketch feeds two.
   */
  featureId?: string
}

export type EdgeAnchor =
  /** The profile curve itself, at one end of the sweep. */
  | (EdgeAnchorBase & {
      kind: 'profileSweep'
      /** Which end of the extrusion: 0 is the sketch plane, 1 is the far face. */
      depth: 0 | 1
    })
  /** A corner running along the sweep, left by one point on the profile. */
  | (EdgeAnchorBase & {
      kind: 'profileLateral'
      /** Where on the entity the corner sits, 0..1 along the curve. */
      t: number
    })

/** A geometric edge fingerprint recorded from the exact viewport mesh. */
export type FilletEdgeReference = {
  /** A point on the selected edge, used to re-find it when the model rebuilds. */
  point: Vec3
  /** Edge endpoints disambiguate parallel edges that pass near the same point. */
  start: Vec3
  end: Vec3
  /**
   * What produced this edge, when it could be worked out. The coordinates above
   * stay as written so an anchor that stops resolving — its entity deleted, say
   * — still degrades to the old behaviour rather than to nothing.
   */
  anchor?: EdgeAnchor
}

export type FilletCornerStyle = 'spherical' | 'mitered'
export type FilletProfileShape = 'rational' | 'quasiAngular' | 'polynomial'

export type FilletParameters = {
  radius: number
  radius2?: number
  cornerStyle?: FilletCornerStyle
  filletShape?: FilletProfileShape
}

/**
 * What produced the face a sketch is attached to.
 *
 * A tagged union so faces made by other features — a revolve's flat end, a
 * fillet's tangent boundary — can be added later without disturbing this one.
 * `core/face-anchor.ts` derives and resolves these.
 */
export type FaceAnchor = {
  kind: 'extrudeCap'
  /** The extrusion whose sweep produced the face. */
  featureId: string
  /** Which end of that sweep: 0 is the sketch-plane end, 1 the far end. */
  depth: 0 | 1
}

export type SketchFaceAttachment = {
  type: 'face'
  featureId: string
  featureName: string
  faceLabel: string
  center: Vec2
  bounds: { min: Vec2; max: Vec2 }
  edges: { start: Vec2; end: Vec2 }[]
  area: number
  /**
   * What made this face, when it could be worked out. Everything else here is
   * a snapshot taken when the sketch was created; this is the one part that
   * still means something after the model changes underneath it.
   */
  anchor?: FaceAnchor
}

export type FeatureParameters = BoxParameters | CylinderParameters | SphereParameters | SketchParameters | ExtrudeParameters | FilletParameters | RevolveParameters

/**
 * A partial update to one feature's parameters.
 *
 * The store patches parameters without knowing which kind of feature it holds,
 * so every parameter name across every kind is allowed and optional. Using the
 * intersection rather than an index signature keeps each value checked against
 * its real type — `axis` still has to be 'X' or 'Y', and a misspelled parameter
 * name is still a compile error.
 */
export type FeatureParameterPatch = Partial<
  BoxParameters & CylinderParameters & SphereParameters & SketchParameters & ExtrudeParameters & FilletParameters & RevolveParameters
>

export type FeatureKind = 'box' | 'cylinder' | 'sphere' | 'sketch' | 'extrude' | 'fillet' | 'revolve'

export type LineEntity = {
  id: string
  type: 'line'
  start: Vec2
  end: Vec2
  construction: boolean
}

export type CircleEntity = {
  id: string
  type: 'circle'
  center: Vec2
  radius: number
  construction: boolean
}

/**
 * A circular arc, held as a centre, a radius and the angles it sweeps between.
 *
 * Angles are radians and always run counter-clockwise, so `endAngle` is greater
 * than `startAngle`; `core/arc-geometry.ts` holds the maths and explains why the
 * endpoint-and-bulge form was rejected. The short version is that this shape
 * shares no fields with a line, so the compiler reports every consumer that
 * still assumes an entity is either a line or a full circle.
 */
export type ArcEntity = {
  id: string
  type: 'arc'
  center: Vec2
  radius: number
  startAngle: number
  endAngle: number
  construction: boolean
}

export type SketchEntity = LineEntity | CircleEntity | ArcEntity

/**
 * The point PlaneGCS holds still while it solves.
 *
 * A solver needs some datum or an under-constrained sketch can drift anywhere
 * that satisfies its constraints. Recording the datum in the document — rather
 * than pinning whichever entity happens to sit first in the array — means
 * reordering or deleting geometry cannot silently change how a sketch solves.
 */
export type SketchAnchor = {
  entityId: string
  point: 'start' | 'center'
}

/**
 * The relationships a sketch can assert between its geometry.
 *
 * `horizontal`, `vertical`, `radius`, `distance` and `angle` describe one
 * entity; the rest relate two. Anything carrying a `value` is a dimension and
 * can be retargeted later, which is what makes a sketch parametric rather than
 * merely solved once.
 */
export type SketchConstraintType =
  | 'horizontal'
  | 'vertical'
  | 'coincident'
  | 'radius'
  | 'distance'
  | 'angle'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal'
  | 'concentric'
  | 'pointOnLine'
  | 'midpoint'
  | 'pointDistance'

/** Which named point of an entity a constraint refers to. */
export type SketchPointRef = 'start' | 'end' | 'center'

export type SketchConstraint = {
  id: string
  type: SketchConstraintType
  entityIds: string[]
  pointRefs?: SketchPointRef[]
  value?: number
  /**
   * A formula driving `value`, when the user gave one instead of a number.
   *
   * The number stays authoritative for the solver and is kept equal to the
   * formula by `core/parameters.ts`. See that module for why the two are stored
   * together rather than one replacing the other.
   */
  formula?: string
}

/** Constraint kinds that carry an editable measurement. */
export const DIMENSION_CONSTRAINTS: readonly SketchConstraintType[] = ['radius', 'distance', 'angle', 'pointDistance']

export function isDimensionConstraint(constraint: SketchConstraint): boolean {
  return DIMENSION_CONSTRAINTS.includes(constraint.type)
}

type FeatureBase = {
  id: string
  kind: FeatureKind
  name: string
  position: Vec3
  rotation: Vec3
  visible: boolean
  /**
   * Formulas driving numeric parameters, keyed by parameter name.
   *
   * A key here never replaces the value in `parameters`: the number stays, and
   * `core/parameters.ts` keeps it equal to what the formula evaluates to. Only
   * the fields `bindableFields` lists can be driven — see that module for why
   * the whitelist exists.
   */
  formulas?: Record<string, string>
}

export type PrimitiveFeature = FeatureBase & {
  kind: 'box' | 'cylinder' | 'sphere'
  parameters: BoxParameters | CylinderParameters | SphereParameters
}

export type SketchFeature = FeatureBase & {
  kind: 'sketch'
  parameters: SketchParameters
  plane: SketchPlane
  entities: SketchEntity[]
  constraints: SketchConstraint[]
  attachment?: SketchFaceAttachment
  anchor?: SketchAnchor
}

export type ExtrudeFeature = FeatureBase & {
  kind: 'extrude'
  parameters: ExtrudeParameters
  sketchId: string
  operation: 'newBody' | 'add' | 'cut'
}

export type FilletFeature = FeatureBase & {
  kind: 'fillet'
  parameters: FilletParameters
  /** The exact edge references selected on the immediately preceding solid. */
  edges: FilletEdgeReference[]
}

export type RevolveFeature = FeatureBase & {
  kind: 'revolve'
  parameters: RevolveParameters
  sketchId: string
  operation: 'newBody' | 'add' | 'cut'
}

export type Feature = PrimitiveFeature | SketchFeature | ExtrudeFeature | FilletFeature | RevolveFeature

export const CURRENT_SCHEMA_VERSION = 8

/**
 * A named value the model can be driven by.
 *
 * The expression, not the number, is what is stored: a parameter is the one
 * place in the document where the formula is the definition rather than an
 * annotation on a number. Its evaluated value is derived on open and after every
 * edit, so it can never drift out of agreement with the formula beside it.
 */
export type DocumentParameter = {
  id: string
  name: string
  /** A formula in the language of `core/expression.ts`. A plain number is valid. */
  expression: string
  comment?: string
}

export type CadDocument = {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION
  id: string
  name: string
  units: 'mm'
  displayUnits?: DisplayUnits
  /** The named parameter table. Optional because documents before v8 have none. */
  parameters?: DocumentParameter[]
  features: Feature[]
  createdAt: string
  updatedAt: string
}

export const createId = () => crypto.randomUUID()

export function createEmptyDocument(): CadDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createId(),
    name: 'Untitled Part',
    units: 'mm',
    displayUnits: 'mm',
    parameters: [],
    features: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createFeature(kind: FeatureKind, index: number, sketchPlane: SketchPlane = 'XY'): Feature {
  const common = {
    id: createId(),
    kind,
    name: `${kind[0].toUpperCase()}${kind.slice(1)} ${index}`,
    position: [0, 0, 0] as Vec3,
    rotation: [0, 0, 0] as Vec3,
    visible: true,
  }

  switch (kind) {
    case 'box':
      return { ...common, kind, parameters: { width: 40, depth: 40, height: 24 } }
    case 'cylinder':
      return { ...common, kind, parameters: { radius: 18, height: 32 } }
    case 'sphere':
      return { ...common, kind, parameters: { radius: 22 } }
    case 'sketch':
      return {
        ...common,
        kind,
        name: `Sketch ${index}`,
        parameters: { planeOffset: 0 },
        plane: sketchPlane,
        entities: [],
        constraints: [],
      }
    case 'extrude':
      throw new Error('Extrude features require a source sketch')
    case 'revolve':
      throw new Error('Revolve features require a source sketch')
    case 'fillet':
      throw new Error('Fillet features require selected edges')
  }
}

export function createExtrudeFeature(sketchId: string, index: number, distance = 25): ExtrudeFeature {
  return {
    id: createId(),
    kind: 'extrude',
    name: `Extrude ${index}`,
    parameters: { distance, symmetric: false, edgeRadius: 0 },
    sketchId,
    operation: 'newBody',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
  }
}

export function createRevolveFeature(sketchId: string, index: number, angle = 360): RevolveFeature {
  return {
    id: createId(),
    kind: 'revolve',
    name: `Revolve ${index}`,
    parameters: { angle, axis: 'Y' },
    sketchId,
    operation: 'newBody',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
  }
}

export function createFilletFeature(
  edges: FilletEdgeReference[],
  index: number,
  radius = 2,
  options?: { cornerStyle?: FilletCornerStyle; filletShape?: FilletProfileShape; radius2?: number },
): FilletFeature {
  return {
    id: createId(),
    kind: 'fillet',
    name: `Fillet ${index}`,
    parameters: {
      radius,
      ...(options?.radius2 !== undefined ? { radius2: options.radius2 } : {}),
      cornerStyle: options?.cornerStyle ?? 'spherical',
      filletShape: options?.filletShape ?? 'rational',
    },
    edges,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
  }
}

export function cloneDocument(document: CadDocument): CadDocument {
  return structuredClone(document)
}

export function validateCadDocument(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object') return { valid: false, errors: ['The file does not contain a project object.'] }
  const document = value as Partial<CadDocument>
  if (document.schemaVersion !== CURRENT_SCHEMA_VERSION) errors.push('Unsupported project schema version.')
  if (typeof document.id !== 'string' || !document.id) errors.push('The project is missing its ID.')
  if (typeof document.name !== 'string') errors.push('The project name is invalid.')
  if (document.units !== 'mm') errors.push('Only millimeter projects are currently supported.')
  if (document.displayUnits !== undefined && !['mm', 'in-decimal', 'in-fractional'].includes(document.displayUnits)) errors.push('The project uses an unsupported display unit mode.')
  if (document.parameters !== undefined) {
    if (!Array.isArray(document.parameters)) errors.push('The project parameter table is invalid.')
    else {
      // A formula that no longer evaluates is *not* an error here. Parameters
      // degrade to the last good number by design, so a document that opens with
      // a broken formula is a document with a warning on it, not a corrupt file.
      for (const [index, parameter] of document.parameters.entries()) {
        const label = `Parameter ${index + 1}`
        if (!parameter || typeof parameter !== 'object') { errors.push(`${label} is invalid.`); continue }
        if (typeof parameter.id !== 'string' || !parameter.id) errors.push(`${label} is missing its ID.`)
        if (typeof parameter.name !== 'string' || !parameter.name) errors.push(`${label} is missing its name.`)
        if (typeof parameter.expression !== 'string') errors.push(`${label} has an invalid formula.`)
      }
    }
  }
  if (!Array.isArray(document.features)) return { valid: false, errors: [...errors, 'The project feature list is invalid.'] }

  const featureIds = new Set<string>()
  for (const [index, candidate] of document.features.entries()) {
    const label = `Feature ${index + 1}`
    if (!candidate || typeof candidate !== 'object') { errors.push(`${label} is invalid.`); continue }
    const feature = candidate as Feature
    if (typeof feature.id !== 'string' || !feature.id) errors.push(`${label} is missing its ID.`)
    else if (featureIds.has(feature.id)) errors.push(`${label} has a duplicate ID.`)
    else featureIds.add(feature.id)
    if (!['box', 'cylinder', 'sphere', 'sketch', 'extrude', 'fillet', 'revolve'].includes(feature.kind)) errors.push(`${label} has an unsupported type.`)
    if (!Array.isArray(feature.position) || feature.position.length !== 3 || feature.position.some((number) => !Number.isFinite(number))) errors.push(`${label} has an invalid position.`)
    if (!feature.parameters || Object.values(feature.parameters).some((parameter) => typeof parameter === 'number' && !Number.isFinite(parameter))) errors.push(`${label} has invalid parameters.`)
    if (feature.formulas !== undefined && (typeof feature.formulas !== 'object' || Object.values(feature.formulas).some((formula) => typeof formula !== 'string'))) errors.push(`${label} has invalid formulas.`)
    if (feature.kind === 'sketch') {
      if (!['XY', 'XZ', 'YZ'].includes(feature.plane)) errors.push(`${label} uses an unsupported sketch plane.`)
      if (!Array.isArray(feature.entities) || !Array.isArray(feature.constraints)) errors.push(`${label} has invalid sketch data.`)
      if (feature.anchor !== undefined) {
        const anchored = feature.entities.some?.((entity) => entity.id === feature.anchor?.entityId)
        if (!['start', 'center'].includes(feature.anchor.point)) errors.push(`${label} has an invalid solver anchor.`)
        else if (!anchored) errors.push(`${label} anchors its solver to missing geometry.`)
      }
      if (feature.attachment !== undefined) {
        if (feature.attachment.type !== 'face' || typeof feature.attachment.featureId !== 'string') errors.push(`${label} has invalid face attachment data.`)
        if (!Array.isArray(feature.attachment.center) || feature.attachment.center.length !== 2 || feature.attachment.center.some((number) => !Number.isFinite(number))) errors.push(`${label} has an invalid face center.`)
        if (!Array.isArray(feature.attachment.edges)) errors.push(`${label} has invalid face reference edges.`)
      }
    }
    if (feature.kind === 'fillet') {
      if (!Number.isFinite(feature.parameters.radius) || feature.parameters.radius <= 0) errors.push(`${label} has an invalid fillet radius.`)
      if (!Array.isArray(feature.edges) || !feature.edges.length) errors.push(`${label} has no selected edges.`)
      for (const edge of feature.edges ?? []) {
        for (const point of [edge.point, edge.start, edge.end]) {
          if (!Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value))) errors.push(`${label} has an invalid edge reference.`)
        }
      }
    }
  }
  for (const feature of document.features) {
    if (feature.kind === 'extrude') {
      const source = document.features.find((candidate) => candidate.id === feature.sketchId)
      if (source?.kind !== 'sketch') errors.push(`${feature.name || 'Extrusion'} references a missing sketch.`)
      if (!Number.isFinite(feature.parameters.distance) || Math.abs(feature.parameters.distance) < 0.001) errors.push(`${feature.name || 'Extrusion'} has an invalid distance.`)
    }
    if (feature.kind === 'revolve') {
      const source = document.features.find((candidate) => candidate.id === feature.sketchId)
      if (source?.kind !== 'sketch') errors.push(`${feature.name || 'Revolve'} references a missing sketch.`)
      if (!Number.isFinite(feature.parameters.angle) || feature.parameters.angle <= 0 || feature.parameters.angle > 360) errors.push(`${feature.name || 'Revolve'} has an invalid angle.`)
      if (!['X', 'Y'].includes(feature.parameters.axis)) errors.push(`${feature.name || 'Revolve'} has an invalid axis.`)
    }
  }
  return { valid: errors.length === 0, errors }
}
