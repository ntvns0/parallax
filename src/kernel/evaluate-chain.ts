import { draw, drawCircle, type Shape3D } from 'replicad'
import { arcAlong, type ClosedProfile, type ProfileRegion } from '../core/sketch'
import { arcMidPoint } from '../core/arc-geometry'
import { extrudeExtent } from './extrude-extent'
import { applyFilletGroup } from './fillet-apply'
import { operationChainCacheKey } from './operation-chain'
import type {
  KernelExtrudeOperation,
  KernelFeatureDiagnostic,
  KernelFilletOperation,
  KernelOperation,
  KernelRevolveOperation,
} from './kernel-types'

/**
 * Turning a chain of kernel operations into one exact solid.
 *
 * Extracted from the worker so it can be exercised against a real OpenCascade
 * build in a test, and so the prefix cache below has somewhere to live that is
 * not tangled up with message plumbing. The worker keeps initialization, request
 * decoding, and output serialization; everything geometric happens here.
 */

function drawingFromProfile(profile: ClosedProfile) {
  if (profile.type === 'circle') {
    return drawCircle(profile.radius).translate(profile.center)
  }
  if (profile.type === 'polygon') {
    const [first, ...rest] = profile.points
    const pen = draw(first)
    rest.forEach((point) => pen.lineTo(point))
    return pen.close()
  }

  // A boundary that mixes straight and curved edges. Arcs are drawn through
  // three points — both ends and the point halfway round — because that form
  // carries no sweep or large-arc flag, so it cannot disagree with the
  // direction the boundary is being travelled.
  const pen = draw(profile.segments[0].start)
  for (const segment of profile.segments) {
    if (segment.kind === 'line') pen.lineTo(segment.end)
    else pen.threePointsArcTo(segment.end, arcMidPoint(arcAlong(segment)))
  }
  return pen.close()
}

/** An outer boundary with its holes cut out, as a single planar drawing. */
function drawingFromRegion(region: ProfileRegion) {
  let drawing = drawingFromProfile(region.outer)
  for (const hole of region.holes) {
    drawing = drawing.cut(drawingFromProfile(hole))
  }
  return drawing
}

/**
 * Run one kernel step, tagging any failure with the step that raised it.
 *
 * OpenCascade often reports a bare numeric status code, which says nothing
 * about where it came from. Naming the step is usually the difference between a
 * diagnosable report and an unactionable one.
 */
export function step<T>(label: string, run: () => T): T {
  try {
    return run()
  } catch (error) {
    throw new Error(`[${label}] ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Extrude every region in one sketch and fuse them into a single tool, so a
 * sketch holding two disjoint profiles produces one operand for the boolean
 * that follows rather than silently contributing only its first profile.
 */
function buildTool(operation: KernelExtrudeOperation): Shape3D {
  const extent = extrudeExtent(operation)
  let tool: Shape3D | null = null
  for (const region of operation.regions) {
    const sketch = step('sketchOnPlane', () => drawingFromRegion(region).sketchOnPlane(operation.plane, operation.planeOffset))
    let solid = step('extrude', () => sketch.extrude(extent.distance) as Shape3D)

    if (extent.origin && extent.origin[2] !== 0) {
      const offset = extent.origin[2]
      let translation: [number, number, number] = [0, 0, 0]
      if (operation.plane === 'XY') translation = [0, 0, offset]
      else if (operation.plane === 'XZ') translation = [0, -offset, 0]
      else if (operation.plane === 'YZ') translation = [offset, 0, 0]

      solid = solid.translate(translation) as Shape3D
    }

    if (!tool) {
      tool = solid
      continue
    }
    const previous: Shape3D = tool
    tool = step('toolFuse', () => previous.fuse(solid) as Shape3D)
  }
  if (!tool) throw new Error('The source sketch does not contain a usable closed profile.')
  return tool
}

function buildRevolveTool(operation: KernelRevolveOperation): Shape3D {
  let tool: Shape3D | null = null

  let axisDir: [number, number, number] = [1, 0, 0]
  let origin: [number, number, number] = [0, 0, 0]

  if (operation.plane === 'XY') {
    axisDir = operation.axis === 'X' ? [1, 0, 0] : [0, 1, 0]
    origin = [0, 0, operation.planeOffset]
  } else if (operation.plane === 'XZ') {
    axisDir = operation.axis === 'X' ? [1, 0, 0] : [0, 0, 1]
    origin = [0, -operation.planeOffset, 0] // Match orientToSketchPlane offset direction
  } else if (operation.plane === 'YZ') {
    axisDir = operation.axis === 'X' ? [0, 1, 0] : [0, 0, 1]
    origin = [operation.planeOffset, 0, 0]
  }

  for (const region of operation.regions) {
    const solid = step('revolve', () => drawingFromRegion(region)
      .sketchOnPlane(operation.plane, operation.planeOffset)
      .revolve(axisDir, { origin, angle: operation.angle }) as Shape3D)

    if (!tool) {
      tool = solid
      continue
    }
    const previous: Shape3D = tool
    tool = step('toolFuse', () => previous.fuse(solid) as Shape3D)
    previous.delete()
    solid.delete()
  }
  if (!tool) throw new Error('The source sketch does not contain a usable closed profile.')
  return tool
}

/**
 * Shapes the caller must not free.
 *
 * The prefix cache below hands out solids it still owns, and a resumed
 * evaluation walks straight past the point where an ordinary run would delete
 * its predecessor. Freeing one of those would corrupt every later request that
 * resumed from the same prefix, and the damage would surface as an unrelated
 * OpenCascade failure much further along. Ownership is therefore tracked
 * explicitly rather than inferred from position in the chain.
 */
/** Anything that can say whether it still owns a shape. */
type Retained = { has(shape: Shape3D): boolean }

/** Free `shape`, unless the prefix cache still owns it. */
function releaseWith(retained: Retained) {
  return (shape: Shape3D | null | undefined) => {
    if (!shape || retained.has(shape)) return
    shape.delete()
  }
}

export type ChainEvaluation = {
  shape: Shape3D
  unresolved: KernelFeatureDiagnostic[]
  /** True when `shape` came from the prefix cache rather than being rebuilt. */
  cached: boolean
  /**
   * Finish with `shape`.
   *
   * Always call this, and never call `shape.delete()` directly: whether the
   * solid is the caller's to free depends on whether the cache is still holding
   * it, which the caller has no way to know. Calling it twice is harmless.
   */
  release: () => void
}

/**
 * Apply `operations` in order, starting from `initial` when one is supplied.
 *
 * A fillet consumes the run of fillets that follows it, because OpenCascade is
 * markedly more reliable when connected fillets go into one builder — see
 * `fillet-apply.ts`. That grouping is also why a run may not be split by the
 * prefix cache.
 */
function applyOperations(
  operations: KernelOperation[],
  initial: Shape3D | null,
  retained: Retained,
  onPrefix?: (index: number, shape: Shape3D, unresolvedSoFar: KernelFeatureDiagnostic[]) => void,
): { shape: Shape3D | null; unresolved: KernelFeatureDiagnostic[] } {
  const release = releaseWith(retained)
  const unresolved: KernelFeatureDiagnostic[] = []
  let shape: Shape3D | null = initial

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]

    if (operation.type === 'fillet') {
      if (!shape) throw new Error('Choose an edge on a solid before adding a fillet.')
      const fillets: KernelFilletOperation[] = [operation]
      while (operations[index + 1]?.type === 'fillet') {
        fillets.push(operations[index + 1] as KernelFilletOperation)
        index += 1
      }
      const unfilleted: Shape3D = shape
      const group = applyFilletGroup(unfilleted, fillets)
      unresolved.push(...group.unresolved)
      shape = group.shape
      // Every fillet in the group may have been skipped, in which case the
      // solid passed straight through and must not be freed.
      if (shape !== unfilleted) release(unfilleted)
      onPrefix?.(index, shape, [...unresolved])
      continue
    }

    const tool = step('buildTool', () => operation.type === 'revolve' ? buildRevolveTool(operation) : buildTool(operation))
    const filletedTool = step('toolFillet', () =>
      operation.type === 'extrude' && operation.edgeRadius > 0 ? tool.fillet(operation.edgeRadius) : tool)
    step('toolFilletDelete', () => { if (filletedTool !== tool) release(tool) })

    if (!shape || operation.operation === 'newBody') {
      const replaced = shape
      step('newBodyDelete', () => release(replaced))
      shape = filletedTool
    } else {
      const previous: Shape3D = shape
      shape = step('boolean', () => operation.operation === 'cut' ? previous.cut(filletedTool) : previous.fuse(filletedTool))
      // The boolean returns a new solid; both operands are now spent. Freeing
      // them here is what keeps a long history from growing OpenCascade memory
      // in proportion to its length.
      step('booleanDelete', () => {
        release(previous)
        release(filletedTool)
      })
    }
    onPrefix?.(index, shape, [...unresolved])
  }

  return { shape, unresolved }
}

/**
 * Where a chain may be cut in half.
 *
 * A run of consecutive fillets goes into one OpenCascade builder and must not
 * be split — applying the same fillets in two groups leaves trimmed tangent
 * seams and produces different geometry (`fillet-apply.ts`). Every other join
 * between operations is a legal boundary, because each one is a point where an
 * ordinary evaluation already holds one complete solid.
 */
function isLegalBoundary(operations: KernelOperation[], length: number): boolean {
  if (length <= 0 || length >= operations.length) return false
  return !(operations[length - 1].type === 'fillet' && operations[length].type === 'fillet')
}

type PrefixEntry = {
  key: string
  length: number
  shape: Shape3D
  /**
   * Diagnostics raised while building this prefix.
   *
   * Cached with the shape because they are not recoverable from it: a fillet
   * skipped for a stale edge reference leaves no trace in the geometry, so a
   * resumed evaluation that did not carry these forward would quietly stop
   * reporting a broken feature the moment its prefix became cacheable.
   */
  unresolved: KernelFeatureDiagnostic[]
}

/**
 * Intermediate solids, kept so that editing the end of a history does not
 * replay the beginning of it.
 *
 * Booleans are ordered, so evaluating feature *n* means re-running features 1..n
 * — and because the mesh cache upstream is keyed on the whole chain, changing
 * one radius on a forty-feature part replays all forty operations through
 * OpenCascade. Keying instead on every *prefix* of the chain lets an edit resume
 * from the last operation that did not change.
 *
 * This needs no stable topological naming. `buildOperationChain` is already a
 * pure function of the document and already resolves references down to
 * concrete geometry, so a given prefix of operations always denotes the same
 * solid. Naming is what dependency-aware recomputation needs — skipping
 * features in the middle of a history — and that remains future work.
 */
class PrefixCache {
  /** Insertion-ordered, oldest first: the iteration order is the LRU order. */
  private readonly entries = new Map<string, PrefixEntry>()
  /**
   * How many entries each shape backs.
   *
   * One solid can legitimately be the answer for several prefixes: a fillet
   * whose edges have all gone is skipped, and the run passes the incoming solid
   * straight through, so the prefixes either side of it name the same object.
   * Counting references is what stops the second entry double-freeing it.
   */
  private readonly live = new Map<Shape3D, number>()
  private hits = 0
  private misses = 0
  private replayed = 0

  constructor(private readonly limit = 24) {}

  /**
   * Count operations actually sent to OpenCascade.
   *
   * This is the number the cache exists to keep small, and unlike elapsed time
   * it is exact and identical on every machine — so it can be asserted rather
   * than eyeballed.
   */
  countReplayed(operations: number): void {
    this.replayed += operations
  }

  /** Shapes the cache owns. An evaluation must not free these. */
  get retained(): Retained {
    return this.live
  }

  get stats() {
    return { hits: this.hits, misses: this.misses, size: this.entries.size, replayed: this.replayed }
  }

  /**
   * The longest cached prefix of `operations`, or null.
   *
   * Candidates come from the cache rather than from the chain, so the search
   * costs one key comparison per resident entry instead of one per operation.
   * A long history is therefore no more expensive to look up than a short one.
   */
  longestPrefix(operations: KernelOperation[]): PrefixEntry | null {
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.length <= operations.length)
      .sort((a, b) => b.length - a.length)

    for (const entry of candidates) {
      if (entry.key !== operationChainCacheKey(operations.slice(0, entry.length))) continue
      // Refresh recency: re-inserting moves the entry to the end of the Map.
      this.entries.delete(entry.key)
      this.entries.set(entry.key, entry)
      this.hits += 1
      return entry
    }
    this.misses += 1
    return null
  }

  store(operations: KernelOperation[], length: number, shape: Shape3D, unresolved: KernelFeatureDiagnostic[]): void {
    const key = operationChainCacheKey(operations.slice(0, length))
    const existing = this.entries.get(key)
    if (existing) {
      // The same prefix evaluated again. Keep whichever shape is already live
      // rather than holding two copies of identical geometry.
      if (existing.shape !== shape) this.discard(existing)
      else {
        this.entries.delete(key)
        this.entries.set(key, existing)
        return
      }
    }
    this.entries.set(key, { key, length, shape, unresolved })
    this.live.set(shape, (this.live.get(shape) ?? 0) + 1)
    this.evict()
  }

  /**
   * Evict oldest-first, never the newest.
   *
   * The newest entry is the solid the caller is still holding, so freeing it
   * would hand back a deleted shape. Bounded by entry count rather than bytes
   * because OpenCascade memory is not cheaply measurable from here.
   */
  private evict(): void {
    while (this.entries.size > this.limit) {
      const oldest = this.entries.values().next().value as PrefixEntry | undefined
      if (!oldest || this.entries.size <= 1) break
      this.entries.delete(oldest.key)
      this.discard(oldest)
    }
  }

  private discard(entry: PrefixEntry): void {
    const references = this.live.get(entry.shape) ?? 0
    if (references > 1) {
      this.live.set(entry.shape, references - 1)
      return
    }
    this.live.delete(entry.shape)
    entry.shape.delete()
  }

  clear(): void {
    for (const entry of this.entries.values()) this.discard(entry)
    this.entries.clear()
    this.hits = 0
    this.misses = 0
    this.replayed = 0
  }
}

const prefixCache = new PrefixCache()

/** Test seam: reset and inspect the cache without exporting the class. */
export const __prefixCache = {
  clear: () => prefixCache.clear(),
  stats: () => prefixCache.stats,
}

/**
 * Evaluate a chain, resuming from the longest cached prefix.
 *
 * The returned shape is owned by the cache whenever `cached` is set, which is
 * the ordinary case; the caller may read it but must not free it.
 */
export function evaluateOperations(operations: KernelOperation[]): ChainEvaluation {
  const resumeFrom = prefixCache.longestPrefix(operations)
  const start = resumeFrom?.length ?? 0

  if (resumeFrom && start === operations.length) {
    return { shape: resumeFrom.shape, unresolved: resumeFrom.unresolved, cached: true, release: () => {} }
  }

  const inherited = resumeFrom?.unresolved ?? []
  prefixCache.countReplayed(operations.length - start)
  const { shape, unresolved } = applyOperations(
    operations.slice(start),
    resumeFrom?.shape ?? null,
    prefixCache.retained,
    (index, intermediate, unresolvedSoFar) => {
      const length = start + index + 1
      if (length < operations.length && !isLegalBoundary(operations, length)) return
      prefixCache.store(operations, length, intermediate, [...inherited, ...unresolvedSoFar])
    },
  )
  if (!shape) throw new Error('No exact solid operations were provided.')

  const solid: Shape3D = shape
  let released = false
  return {
    shape: solid,
    unresolved: [...inherited, ...unresolved],
    cached: false,
    release: () => {
      if (released || prefixCache.retained.has(solid)) return
      released = true
      solid.delete()
    },
  }
}
