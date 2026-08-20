import { currentEdgeReference } from '../core/edge-anchor'
import { currentPlaneOffset } from '../core/face-anchor'
import { planeNormalDistance } from '../core/extrude-direction'
import type { Feature } from '../core/model'
import { getProfileRegions } from '../core/sketch'
import type { KernelOperation } from './kernel-types'

/**
 * Replay every extrusion up to and including `feature` as a flat list of kernel
 * operations.
 *
 * Booleans are ordered, so evaluating one feature means re-running the ones
 * before it. Features whose sketch is missing or has no closed region drop out
 * rather than aborting the chain — a broken sketch halfway down the history
 * should not make the rest of the part unevaluable.
 *
 * This is also the cache key for exact evaluation, which is why it has to be a
 * pure function of the document.
 */
export function buildOperationChain(feature: Extract<Feature, { kind: 'extrude' | 'fillet' | 'revolve' }>, features: Feature[]): KernelOperation[] {
  const featureIndex = features.findIndex((candidate) => candidate.id === feature.id)
  const relevant = features.slice(0, featureIndex >= 0 ? featureIndex + 1 : features.length)

  const operations: KernelOperation[] = []
  for (const candidate of relevant) {
    if (candidate.kind === 'fillet') {
      operations.push({
        type: 'fillet' as const,
        featureId: candidate.id,
        featureName: candidate.name,
        radius: candidate.parameters.radius,
        ...(candidate.parameters.radius2 !== undefined ? { radius2: candidate.parameters.radius2 } : {}),
        cornerStyle: candidate.parameters.cornerStyle ?? 'spherical',
        filletShape: candidate.parameters.filletShape ?? 'rational',
        edges: candidate.edges.map((edge) => currentEdgeReference(edge, features)),
      })
      continue
    }
    if (candidate.kind === 'extrude') {
      const sketch = features.find((source) => source.id === candidate.sketchId)
      if (sketch?.kind !== 'sketch') continue
      const regions = getProfileRegions(sketch)
      if (!regions.length) continue
      const distance = planeNormalDistance(candidate.parameters.distance, sketch.parameters.faceNormalSign)

      operations.push({
        type: 'extrude' as const,
        featureId: candidate.id,
        featureName: candidate.name,
        sketchId: sketch.id,
        regions,
        plane: sketch.plane,
        planeOffset: currentPlaneOffset(sketch, features),
        distance,
        symmetric: candidate.parameters.symmetric,
        operation: candidate.operation,
        edgeRadius: candidate.parameters.edgeRadius ?? 0,
      })
    } else if (candidate.kind === 'revolve') {
      const sketch = features.find((source) => source.id === candidate.sketchId)
      if (sketch?.kind !== 'sketch') continue
      const regions = getProfileRegions(sketch)
      if (!regions.length) continue

      operations.push({
        type: 'revolve' as const,
        featureId: candidate.id,
        featureName: candidate.name,
        sketchId: sketch.id,
        regions,
        plane: sketch.plane,
        planeOffset: currentPlaneOffset(sketch, features),
        angle: candidate.parameters.angle,
        axis: candidate.parameters.axis,
        operation: candidate.operation,
      })
    }
  }
  return operations
}

/**
 * Generate a cache key that excludes display-only presentation attributes like featureName.
 */
export function operationChainCacheKey(operations: KernelOperation[]): string {
  const normalized = operations.map((op) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { featureName, ...geometricProps } = op
    return geometricProps
  })
  return JSON.stringify({ operations: normalized })
}

/** A compact form of the chain for diagnostics, without the full profile data. */
export function describeOperationChain(operations: KernelOperation[]) {
  return operations.map((operation, index) => ({
    index: index + 1,
    featureId: operation.featureId,
    featureName: operation.featureName,
    ...(operation.type === 'extrude'
      ? {
          sketchId: operation.sketchId,
          operation: operation.operation,
          plane: operation.plane,
          planeOffset: operation.planeOffset,
          distance: operation.distance,
          symmetric: operation.symmetric,
          regions: operation.regions.map((region) => ({ outer: region.outer.type, holes: region.holes.length })),
          edgeRadius: operation.edgeRadius,
        }
      : operation.type === 'revolve' ? {
          sketchId: operation.sketchId,
          operation: operation.operation,
          plane: operation.plane,
          planeOffset: operation.planeOffset,
          angle: operation.angle,
          axis: operation.axis,
          regions: operation.regions.map((region) => ({ outer: region.outer.type, holes: region.holes.length })),
        }
      : { radius: operation.radius, selectedEdges: operation.edges.length }),
  }))
}
