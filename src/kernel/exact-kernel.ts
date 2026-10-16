import { create } from 'zustand'
import * as THREE from 'three'
import { isSolidFeature, type ExtrudeFeature, type RevolveFeature, type Feature, type FilletFeature, type SketchFeature, type SolidFeature } from '../core/model'
import { getProfileRegions } from '../core/sketch'
import { buildOperationChain, describeOperationChain } from './operation-chain'
import type { KernelExportFormat, KernelFeatureDiagnostic, KernelMesh, KernelRequest, ViewportMeshResult } from './kernel-types'
import { KernelClient, type KernelProjection } from './kernel-client'
import { recordFeatureDiagnostics } from '../core/diagnostics'
import { listBodies } from '../core/bodies'

export { useFeatureDiagnosticsStore } from '../core/diagnostics'

type KernelStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useKernelStore = create<{ status: KernelStatus; message: string }>(() => ({
  status: 'idle',
  message: 'Exact kernel available',
}))

function recordChainDiagnostics(chainFeatureIds: string[], unresolved: KernelFeatureDiagnostic[]) {
  recordFeatureDiagnostics(chainFeatureIds, unresolved)
}

const kernelClient = new KernelClient({
  onStatusChange: (status, message) => useKernelStore.setState({ status, message }),
})

type ExactFeature = SolidFeature

export function cachedExactMesh(feature: ExactFeature, features: Feature[]): KernelMesh | null {
  const operations = buildOperationChain(feature, features)
  return kernelClient.getCachedMesh(operations)
}

export async function evaluateExactExtrude(feature: ExactFeature, sketch: SketchFeature | undefined, features: Feature[] = sketch ? [sketch, feature] : [feature]) {
  if (feature.kind === 'extrude' && (!Number.isFinite(feature.parameters.distance) || Math.abs(feature.parameters.distance) < 0.001)) {
    const message = 'Enter an extrusion distance greater than 0.001 mm.'
    useKernelStore.setState({ status: 'error', message })
    throw new Error(message)
  }
  if (feature.kind === 'revolve' && (!Number.isFinite(feature.parameters.angle) || feature.parameters.angle <= 0)) {
    const message = 'Enter a revolve angle greater than 0.'
    useKernelStore.setState({ status: 'error', message })
    throw new Error(message)
  }
  if ((feature.kind === 'extrude' || feature.kind === 'revolve') && (!sketch || !getProfileRegions(sketch).length)) throw new Error('Sketch has no closed profile')

  const operations = buildOperationChain(feature, features)
  const chainFeatureIds = operations.map((operation) => operation.featureId)
  const describeContext = describeOperationChain(operations)

  const mesh = await kernelClient.evaluateMesh(operations, describeContext)
  recordChainDiagnostics(chainFeatureIds, mesh.unresolved ?? [])
  return mesh
}

export async function evaluateViewportMesh(
  feature: ExactFeature,
  sketch: SketchFeature | undefined,
  features: Feature[] = sketch ? [sketch, feature] : [feature],
): Promise<ViewportMeshResult> {
  if ((feature.kind === 'extrude' || feature.kind === 'revolve') && (!sketch || !getProfileRegions(sketch).length)) {
    throw new Error('Sketch has no closed profile')
  }
  const operations = buildOperationChain(feature, features)
  const result = await kernelClient.evaluateViewportMesh(operations, describeOperationChain(operations))
  if (result.status === 'ready') {
    recordChainDiagnostics(operations.map((operation) => operation.featureId), result.mesh.unresolved ?? [])
  }
  return result
}

export async function preflightExactFillet(targetFeatureId: string, preview: FilletFeature, features: Feature[]) {
  if (!features.some((feature) => feature.id === targetFeatureId)) throw new Error('The fillet target is no longer available.')
  const mesh = await evaluateExactExtrude(preview, undefined, [...features, preview])
  const unresolvedPreview = mesh.unresolved.find((diagnostic) => diagnostic.featureId === preview.id)
  if (unresolvedPreview) throw new Error(unresolvedPreview.message)
  return mesh
}

async function exportExact(feature: ExtrudeFeature | RevolveFeature, sketch: SketchFeature, features: Feature[], format: KernelExportFormat) {
  if (feature.kind === 'extrude' && (!Number.isFinite(feature.parameters.distance) || Math.abs(feature.parameters.distance) < 0.001)) {
    throw new Error('Enter an extrusion distance greater than 0.001 mm before exporting.')
  }
  if (!getProfileRegions(sketch).length) throw new Error('Sketch has no closed profile')
  const operations = buildOperationChain(feature, features)
  const describeContext = describeOperationChain(operations)
  return kernelClient.exportGeometry([operations], format, describeContext)
}

export function exportExactStep(feature: ExtrudeFeature | RevolveFeature, sketch: SketchFeature, features: Feature[] = [sketch, feature]) {
  return exportExact(feature, sketch, features, 'step')
}

export function exportExactStl(feature: ExtrudeFeature | RevolveFeature, sketch: SketchFeature, features: Feature[] = [sketch, feature]) {
  return exportExact(feature, sketch, features, 'stl')
}

/**
 * The finished state of every body: the last feature of each. Hidden bodies
 * are included, because hiding the lid to look inside the box should not drop
 * it from the file.
 */
function finalBodyFeatures(features: Feature[]): SolidFeature[] {
  return listBodies(features).flatMap((body) => {
    const final = features.find((feature) => feature.id === body.featureIds.at(-1))
    return final && isSolidFeature(final) ? [final] : []
  })
}

export function hasExactSolid(features: Feature[]): boolean {
  return features.some(isSolidFeature)
}

export async function exportExactDocument(features: Feature[], format: KernelExportFormat): Promise<Blob> {
  const finals = finalBodyFeatures(features)
  if (!finals.length) {
    throw new Error('No 3D solid available to export. Create and extrude a sketch first.')
  }
  const bodies = finals.map((solid) => buildOperationChain(solid, features))
  return kernelClient.exportGeometry(bodies, format, bodies.map(describeOperationChain))
}

/**
 * Project the finished part into drawing views.
 *
 * Drawings are generated from the model on demand rather than stored, so a
 * sheet can never disagree with the geometry it claims to describe.
 */
export async function projectExactDocument(
  features: Feature[],
  request: NonNullable<KernelRequest['projection']>,
): Promise<KernelProjection> {
  const finals = finalBodyFeatures(features)
  if (!finals.length) {
    throw new Error('No 3D solid available to draw. Create and extrude a sketch first.')
  }
  const bodies = finals.map((solid) => buildOperationChain(solid, features))
  const chainFeatureIds = bodies.flat().map((operation) => operation.featureId)
  const projection = await kernelClient.evaluateProjection(bodies, request, bodies.map(describeOperationChain))
  recordChainDiagnostics(chainFeatureIds, projection.unresolved)
  return projection
}

export function kernelMeshToGeometry(mesh: KernelMesh) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1))
  geometry.userData.faceGroups = mesh.faceGroups
  geometry.computeBoundingSphere()
  return geometry
}
