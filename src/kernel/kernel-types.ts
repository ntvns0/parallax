import type { ProfileRegion } from '../core/sketch'
import type { FilletEdgeReference, SketchPlane } from '../core/model'
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
  axis: 'X' | 'Y'
  operation: 'newBody' | 'add' | 'cut'
}

export type KernelOperation = KernelExtrudeOperation | KernelFilletOperation | KernelRevolveOperation

/** What the caller wants back once the feature chain has been evaluated. */
export type KernelOutput = 'mesh' | KernelExportFormat | 'projection'

export type KernelRequest = {
  id: number
  type: 'extrude' | 'revolve'
  operations: KernelOperation[]
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
  vertices: number[]
  normals: number[]
  triangles: number[]
  faceGroups: { start: number; count: number; faceId: number }[]
  edgeLines: number[]
  edgeGroups: { start: number; count: number; edgeId: number }[]
  /** Features skipped to produce this mesh. Empty when everything applied. */
  unresolved: KernelFeatureDiagnostic[]
}

export type KernelResponse =
  | { id: number; ok: true; type: 'mesh'; mesh: KernelMesh }
  | { id: number; ok: true; type: KernelExportFormat; bytes: Uint8Array }
  | { id: number; ok: true; type: 'projection'; views: ProjectedView[]; unresolved: KernelFeatureDiagnostic[] }
  | { id: number; ok: false; error: string }
