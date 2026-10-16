import { bodyMembership } from '../core/bodies'
import { currentEdgeReference } from '../core/edge-anchor'
import { currentPlaneOffset } from '../core/face-anchor'
import { planeNormalDistance } from '../core/extrude-direction'
import { holePlacements, holeProblem } from '../core/hole'
import { patternSeeds, patternTransforms } from '../core/pattern'
import { currentFaceReference, shellProblem } from '../core/shell'
import type { Feature, SolidFeature } from '../core/model'
import { revolveAxis } from '../core/revolve-axis'
import { getProfileRegions } from '../core/sketch'
import type { KernelOperation, KernelPatternSeed } from './kernel-types'

/**
 * Replay every feature of `feature`'s body, up to and including `feature`, as
 * a flat list of kernel operations. Other bodies are not part of it: see
 * `core/bodies.ts`.
 *
 * Booleans are ordered, so evaluating one feature means re-running the ones
 * before it. Features whose sketch is missing or has no closed region drop out
 * rather than aborting the chain — a broken sketch halfway down the history
 * should not make the rest of the part unevaluable.
 *
 * This is also the cache key for exact evaluation, which is why it has to be a
 * pure function of the document.
 */
export function buildOperationChain(feature: SolidFeature, features: Feature[]): KernelOperation[] {
  const featureIndex = features.findIndex((candidate) => candidate.id === feature.id)
  const membership = bodyMembership(features)
  const body = membership.get(feature.id)
  const relevant = features
    .slice(0, featureIndex >= 0 ? featureIndex + 1 : features.length)
    .filter((candidate) => body === undefined || membership.get(candidate.id) === body)
  return relevant.flatMap((candidate) => {
    const operation = operationFor(candidate, features)
    return operation ? [operation] : []
  })
}

/** The kernel operation for one feature, or null when it contributes nothing. */
function operationFor(candidate: Feature, features: Feature[]): KernelOperation | null {
  if (candidate.kind === 'fillet') {
    return {
      type: 'fillet' as const,
      featureId: candidate.id,
      featureName: candidate.name,
      radius: candidate.parameters.radius,
      blend: candidate.parameters.blend ?? 'round',
      ...(candidate.parameters.radius2 !== undefined ? { radius2: candidate.parameters.radius2 } : {}),
      cornerStyle: candidate.parameters.cornerStyle ?? 'spherical',
      filletShape: candidate.parameters.filletShape ?? 'rational',
      edges: candidate.edges.map((edge) => currentEdgeReference(edge, features)),
    }
  }
  if (candidate.kind === 'pattern') {
    // A pattern with nothing to copy, or numbers that make no copies, does
    // nothing, and is left out so it cannot change the cache key either.
    const transforms = patternTransforms(candidate.parameters)
    const seeds = patternSeeds(candidate, features)
      .map((seed) => operationFor(seed, features))
      .filter((seed): seed is KernelPatternSeed => seed !== null && seed.type !== 'fillet' && seed.type !== 'pattern')
    if (!transforms.length || !seeds.length) return null
    return { type: 'pattern' as const, featureId: candidate.id, featureName: candidate.name, seeds, transforms }
  }
  if (candidate.kind === 'shell') {
    // Walls that cannot be made leave the solid alone; the panel says why.
    if (shellProblem(candidate.parameters)) return null
    return {
      type: 'shell' as const,
      featureId: candidate.id,
      featureName: candidate.name,
      thickness: candidate.parameters.thickness,
      faces: candidate.faces.map((face) => {
        const { point, normal } = currentFaceReference(face, features)
        return { point, normal }
      }),
    }
  }
  if (candidate.kind === 'hole') {
    // A hole with no points drills nothing, and is left out so it cannot
    // change the cache key of the chain it sits in.
    const placements = holePlacements(candidate, features)
    if (!placements.length) return null
    // Sizes that cannot make a hole drill nothing; the property panel says why.
    if (holeProblem(candidate.parameters)) return null
    // The preset is intent for callouts, not geometry, so it stays out of the key.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { preset, ...parameters } = candidate.parameters
    return { type: 'hole' as const, featureId: candidate.id, featureName: candidate.name, placements, parameters }
  }
  if (candidate.kind === 'extrude') {
    const sketch = features.find((source) => source.id === candidate.sketchId)
    if (sketch?.kind !== 'sketch') return null
    const regions = getProfileRegions(sketch)
    if (!regions.length) return null
    const distance = planeNormalDistance(candidate.parameters.distance, sketch.parameters.faceNormalSign)

    return {
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
    }
  }
  if (candidate.kind === 'revolve') {
    const sketch = features.find((source) => source.id === candidate.sketchId)
    if (sketch?.kind !== 'sketch') return null
    const regions = getProfileRegions(sketch)
    if (!regions.length) return null
    const planeOffset = currentPlaneOffset(sketch, features)
    // A revolve whose axis line was deleted cannot be built; diagnostics say so.
    const axis = revolveAxis(candidate, sketch, planeOffset)
    if (!axis) return null

    return {
      type: 'revolve' as const,
      featureId: candidate.id,
      featureName: candidate.name,
      sketchId: sketch.id,
      regions,
      plane: sketch.plane,
      planeOffset,
      angle: candidate.parameters.angle,
      axisOrigin: axis.origin,
      axisDirection: axis.direction,
      operation: candidate.operation,
    }
  }
  return null
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
          axisOrigin: operation.axisOrigin,
          axisDirection: operation.axisDirection,
          regions: operation.regions.map((region) => ({ outer: region.outer.type, holes: region.holes.length })),
        }
      : operation.type === 'hole' ? { form: operation.parameters.form, holes: operation.placements.length }
      : operation.type === 'pattern' ? { seeds: operation.seeds.map((seed) => seed.featureId), copies: operation.transforms.length }
      : operation.type === 'shell' ? { thickness: operation.thickness, openFaces: operation.faces.length }
      : { radius: operation.radius, selectedEdges: operation.edges.length }),
  }))
}
