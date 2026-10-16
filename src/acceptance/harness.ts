import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import { getOC, measureVolume, setOC, type Shape3D } from 'replicad'
import { GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs'
import { listBodies } from '../core/bodies'
import { parseStoredDocument } from '../core/document-migration'
import { drivenSketches } from '../core/driven-sketches'
import {
  createId,
  isSolidFeature,
  type CadDocument,
  type DocumentParameter,
  type Feature,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type Vec2,
} from '../core/model'
import { resolveDocumentFormulas } from '../core/parameters'
import { resolveSketchAnchor } from '../core/sketch'
import { buildOperationChain, operationChainCacheKey } from '../kernel/operation-chain'
import { evaluateBodies, evaluateOperations } from '../kernel/evaluate-chain'
import { solveWithPlaneGcs } from '../sketcher/planegcs-solve'

/**
 * The machinery behind the acceptance parts: real OpenCascade, real PlaneGCS,
 * and the same formula and solve path the application runs, with no browser.
 *
 * A part is a document. `rebuild` does to it what the application does after
 * an edit — resolve formulas, solve the sketches they drive, evaluate the
 * operation chain — and reports what came out.
 */

// Resolved from the working directory: under jsdom, import.meta.url is not a
// file URL. See the kernel behaviour notes in ROADMAP.md.
const OC_WASM = resolve(process.cwd(), 'node_modules/replicad-opencascadejs/src/replicad_single.wasm')
const GCS_WASM = resolve(process.cwd(), 'node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')

let planeGcs: GcsWrapper | null = null

/** Load both WebAssembly kernels. Call from `beforeAll`, with a long timeout. */
export async function loadKernels(): Promise<void> {
  const init = initOpenCascade as unknown as (
    config: { locateFile: () => string; wasmBinary: Buffer },
  ) => Promise<Parameters<typeof setOC>[0]>
  setOC(await init({ locateFile: () => OC_WASM, wasmBinary: readFileSync(OC_WASM) }))
  const gcsInit = init_planegcs_module as unknown as (config: { locateFile: () => string; wasmBinary: Buffer }) => ReturnType<typeof init_planegcs_module>
  const module = await gcsInit({ locateFile: () => GCS_WASM, wasmBinary: readFileSync(GCS_WASM) })
  planeGcs = new GcsWrapper(new module.GcsSystem(), module)
}

/** Solve one sketch as the sketcher would, failing loudly on a bad sketch. */
export function solveSketch(sketch: SketchFeature): SketchFeature {
  if (!planeGcs) throw new Error('Call loadKernels() before solving.')
  const anchor = resolveSketchAnchor(sketch.entities, sketch.anchor)
  const response = solveWithPlaneGcs(planeGcs, { id: 0, entities: sketch.entities, constraints: sketch.constraints, anchor })
  if (!response.converged) throw new Error(`${sketch.name} has no solution for its dimensions.`)
  const trouble = [...response.conflicting, ...response.redundant, ...response.unsupported]
  if (trouble.length) throw new Error(`${sketch.name} does not solve cleanly: ${trouble.join(', ')}`)
  return { ...sketch, entities: response.entities, anchor }
}

/** Resolve formulas and solve every driven sketch: what one edit costs in the app. */
export function settle(document: CadDocument): CadDocument {
  const { document: resolved, diagnostics } = resolveDocumentFormulas(document)
  if (diagnostics.length) throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'))
  const driven = new Set(drivenSketches(resolved))
  return {
    ...resolved,
    features: resolved.features.map((feature) => feature.kind === 'sketch' && driven.has(feature.id) ? solveSketch(feature) : feature),
  }
}

/** Change parameter expressions by name, then settle the document. */
export function withParameters(document: CadDocument, changes: Record<string, string>): CadDocument {
  const names = new Set((document.parameters ?? []).map((parameter) => parameter.name))
  for (const name of Object.keys(changes)) if (!names.has(name)) throw new Error(`No parameter named ${name}.`)
  return settle({
    ...document,
    parameters: (document.parameters ?? []).map((parameter) =>
      changes[parameter.name] === undefined ? parameter : { ...parameter, expression: changes[parameter.name] }),
  })
}

/** Each body's chain, up to its last feature: the finished part, a body at a time. */
function bodyChains(document: CadDocument) {
  const chains = listBodies(document.features).flatMap((body) => {
    const final = document.features.find((feature) => feature.id === body.featureIds.at(-1))
    return final && isSolidFeature(final) ? [buildOperationChain(final, document.features)] : []
  })
  if (!chains.length) throw new Error('The part has no solid-producing feature.')
  return chains
}

/** Evaluate the part, every body of it, and read something off the result. */
export function withSolid<T>(document: CadDocument, read: (shape: Shape3D) => T): T {
  const chains = bodyChains(document)
  const evaluation = chains.length > 1 ? evaluateBodies(chains) : evaluateOperations(chains[0])
  try {
    if (evaluation.unresolved.length) {
      throw new Error(`Unresolved references: ${evaluation.unresolved.map((item) => JSON.stringify(item)).join('; ')}`)
    }
    return read(evaluation.shape)
  } finally {
    evaluation.release()
  }
}

export type PartReport = {
  volume: number
  bodies: number
  valid: boolean
  min: [number, number, number]
  max: [number, number, number]
}

/** Count sub-shapes of one topological type, through OpenCascade directly. */
function countSubShapes(shape: Shape3D, type: 'TopAbs_SOLID') {
  const oc = getOC() as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const explorer = new oc.TopExp_Explorer_2(shape.wrapped, oc.TopAbs_ShapeEnum[type], oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
  let count = 0
  for (; explorer.More(); explorer.Next()) count += 1
  explorer.delete()
  return count
}

function isValidShape(shape: Shape3D) {
  const oc = getOC() as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false)
  const valid = analyzer.IsValid_2()
  analyzer.delete()
  return valid as boolean
}

/** Bounds are rounded to 0.001 mm, and `+ 0` turns -0 into 0. */
const round = (value: number) => Math.round(value * 1000) / 1000 + 0

/**
 * The box round the geometry itself. Replicad's `boundingBox` is inflated by
 * each shape's tolerance, and a shell's is 1e-3 mm whatever it is asked for,
 * so that box would put a shelled part a micrometre outside its own walls.
 */
function exactBounds(shape: Shape3D): [number[], number[]] {
  const oc = getOC() as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const box = new oc.Bnd_Box_1()
  try {
    oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    const [min, max] = [box.CornerMin(), box.CornerMax()]
    const bounds: [number[], number[]] = [[min.X(), min.Y(), min.Z()], [max.X(), max.Y(), max.Z()]]
    min.delete()
    max.delete()
    return bounds
  } finally {
    box.delete()
  }
}

export function inspectPart(document: CadDocument): PartReport {
  return withSolid(document, (shape) => {
    const [min, max] = exactBounds(shape)
    return {
      volume: measureVolume(shape),
      bodies: countSubShapes(shape, 'TopAbs_SOLID'),
      valid: isValidShape(shape),
      min: min.map(round) as [number, number, number],
      max: max.map(round) as [number, number, number],
    }
  })
}

/** Save and reopen through the real storage parser, as a reload would. */
export function roundTrip(document: CadDocument): CadDocument {
  const reopened = parseStoredDocument(JSON.stringify(document))
  if (!reopened) throw new Error('The saved part did not reopen.')
  return reopened
}

export function solidCacheKey(document: CadDocument) {
  return bodyChains(document).map(operationChainCacheKey).join('\n')
}

// ---------------------------------------------------------------------------
// Authoring helpers. Parts are written as profiles with their dimensions and
// the named parameters that drive them, the way a person would build them.

export function parameter(name: string, expression: string): DocumentParameter {
  return { id: `param-${name}`, name, expression }
}

export function feature<T extends Feature>(value: Omit<T, 'position' | 'rotation' | 'visible'>): T {
  return { position: [0, 0, 0], rotation: [0, 0, 0], visible: true, ...value } as T
}

/**
 * A closed polyline, its corners tied together, each edge held horizontal or
 * vertical when it is axis-aligned. Returns the entity ids in order so the
 * caller can dimension particular edges.
 */
export function closedPolyline(prefix: string, corners: Vec2[]): { entities: SketchEntity[]; constraints: SketchConstraint[]; ids: string[] } {
  const ids = corners.map((_, index) => `${prefix}-${index}`)
  const entities: SketchEntity[] = corners.map((start, index) => ({
    id: ids[index], type: 'line', start, end: corners[(index + 1) % corners.length], construction: false,
  }))
  const constraints: SketchConstraint[] = []
  corners.forEach((start, index) => {
    const end = corners[(index + 1) % corners.length]
    if (start[1] === end[1]) constraints.push({ id: createId(), type: 'horizontal', entityIds: [ids[index]] })
    else if (start[0] === end[0]) constraints.push({ id: createId(), type: 'vertical', entityIds: [ids[index]] })
    constraints.push({
      id: createId(), type: 'coincident', entityIds: [ids[index], ids[(index + 1) % corners.length]], pointRefs: ['end', 'start'],
    })
  })
  return { entities, constraints, ids }
}

/** A length dimension on one line, driven by a formula. */
export function drivenLength(entityId: string, value: number, formula: string): SketchConstraint {
  return { id: createId(), type: 'distance', entityIds: [entityId], value, formula }
}
