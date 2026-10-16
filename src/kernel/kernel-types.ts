import type { ProfileRegion } from '../core/sketch'
import type { HolePlacement } from '../core/hole'
import type { PatternTransform } from '../core/pattern'
import type { FaceReference, FilletEdgeReference, HoleParameters, SketchPlane, Vec3 } from '../core/model'
import type { DrawingViewId, OrthographicViewId, ProjectedView } from '../drawing/drawing-types'
import type { FeatureDiagnostic } from '../core/diagnostics'

export type KernelExportFormat = 'step' | 'stl'

export type KernelExtrudeOperation = {
  type: 'extrude'
  featureId: string
  featureName: string
  sketchId: string
  regions: ProfileRegion[]
  plane: SketchPlane
  planeOffset: number
  distance: number
  symmetric: boolean
  operation: 'newBody' | 'add' | 'cut'
  edgeRadius: number
}

export type KernelFilletOperation = {
  type: 'fillet'
  featureId: string
  featureName: string
  radius: number
  /** Rounds and chamfers need different OpenCascade builders, so a run never mixes them. */
  blend: 'round' | 'chamfer'
  radius2?: number
  cornerStyle?: 'spherical' | 'mitered'
  filletShape?: 'rational' | 'quasiAngular' | 'polynomial'
  edges: FilletEdgeReference[]
}

export type KernelRevolveOperation = {
  type: 'revolve'
  featureId: string
  featureName: string
  sketchId: string
  regions: ProfileRegion[]
  plane: SketchPlane
  planeOffset: number
  angle: number
  /** The axis in world space; `axisDirection` has unit length. See `core/revolve-axis.ts`. */
  axisOrigin: Vec3
  axisDirection: Vec3
  operation: 'newBody' | 'add' | 'cut'
}

export type KernelHoleOperation = {
  type: 'hole'
  featureId: string
  featureName: string
  placements: HolePlacement[]
  parameters: HoleParameters
}

/** What a pattern can copy: anything built from a tool and a boolean. */
export type KernelPatternSeed = KernelExtrudeOperation | KernelRevolveOperation | KernelHoleOperation

export type KernelPatternOperation = {
  type: 'pattern'
  featureId: string
  featureName: string
  /** The copied features' own operations, rebuilt here and moved by each transform. */
  seeds: KernelPatternSeed[]
  transforms: PatternTransform[]
}

export type KernelShellOperation = {
  type: 'shell'
  featureId: string
  featureName: string
  thickness: number
  /** Where each face to open now is. Anchors are resolved before this point. */
  faces: Pick<FaceReference, 'point' | 'normal'>[]
}

export type KernelOperation = KernelExtrudeOperation | KernelFilletOperation | KernelRevolveOperation | KernelHoleOperation | KernelPatternOperation | KernelShellOperation

/** What the caller wants back once the feature chain has been evaluated. */
export type KernelOutput = 'mesh' | KernelExportFormat | 'projection'

export type KernelRequest = {
  id: number
  type: 'extrude' | 'revolve'
  operations: KernelOperation[]
  /**
   * Every body's chain, for exporting or drawing a part with more than one.
   * The output is all of them together; `operations` is then the first.
   */
  bodies?: KernelOperation[][]
  output: KernelOutput
  /** Required for `projection` output; ignored otherwise. */
  projection?: {
    views: DrawingViewId[]
    hiddenLines: boolean
    section?: { parent: OrthographicViewId; position: number; label: string }
  }
}

/**
 * One feature that could not be applied, reported alongside a solid that was
 * built without it.
 *
 * A feature whose reference no longer resolves is a problem with that feature,
 * not with the part. Aborting the whole chain throws away every feature after
 * it too, so the user loses a model to fix one fillet.
 */
export type KernelFeatureDiagnostic = FeatureDiagnostic

export type KernelMesh = {
  vertices: Float32Array
  normals: Float32Array
  triangles: Uint32Array
  faceGroups: { start: number; count: number; faceId: number }[]
  edgeLines: Float32Array
  edgeGroups: { start: number; count: number; edgeId: number }[]
  /** Features skipped to produce this mesh. Empty when everything applied. */
  unresolved: KernelFeatureDiagnostic[]
}

export type ViewportMeshResult =
  | { status: 'ready'; mesh: KernelMesh }
  | { status: 'superseded' }

export type KernelWorkerTimings = {
  initializationMs: number
  evaluationMs: number
  outputMs: number
  responseBytes: number
}

export type KernelResponse =
  | { id: number; ok: true; type: 'mesh'; mesh: KernelMesh; timings?: KernelWorkerTimings }
  | { id: number; ok: true; type: KernelExportFormat; bytes: Uint8Array; timings?: KernelWorkerTimings }
  | { id: number; ok: true; type: 'projection'; views: ProjectedView[]; unresolved: KernelFeatureDiagnostic[]; timings?: KernelWorkerTimings }
  | { id: number; ok: false; error: string; timings?: KernelWorkerTimings }
