import { logDiagnostic } from '../core/diagnostics'
import type { ProjectedView } from '../drawing/drawing-types'
import type { KernelExportFormat, KernelFeatureDiagnostic, KernelMesh, KernelRequest, KernelResponse, ViewportMeshResult } from './kernel-types'
import { operationChainCacheKey } from './operation-chain'
import type { KernelOperation } from './kernel-types'
import { clientRuntime } from '../runtime/client-runtime'
import { recordPerformance, recordPerformanceDuration } from '../runtime/performance'

export type KernelProjection = { views: ProjectedView[]; unresolved: KernelFeatureDiagnostic[] }

function meshBytes(mesh: KernelMesh): number {
  return mesh.vertices.byteLength + mesh.normals.byteLength + mesh.triangles.byteLength + mesh.edgeLines.byteLength
    + (mesh.faceGroups.length + mesh.edgeGroups.length) * 48
}

function readableKernelError(error: string): string {
  if (/fillet|radius/i.test(error) && /too large|bounds|consume|empty/i.test(error)) return error
  if (/9010760/.test(error)) return 'The feature has no volume. Enter a non-zero extrusion distance.'
  if (/memory|allocation/i.test(error)) return 'The exact geometry engine ran out of memory. Reload the project and try again.'
  if (/closed profile/i.test(error)) return 'The source sketch does not contain a usable closed profile.'
  if (/no edge was selected/i.test(error)) return 'The selected edge could not be matched in the exact solid. Cancel and select the edge again.'
  if (/^\d+$/.test(error.trim())) return `OpenCascade could not evaluate the fillet (kernel code ${error.trim()}). The requested radius may be too large for the adjacent face boundaries. Try reducing the radius (e.g. from 0.079" to 0.063" / 1.6 mm) so the fillet fits within the feature.`
  return error || 'The exact geometry engine could not evaluate this feature.'
}

export class KernelClient {
  private worker: Worker | null = null
  private requestId = 0
  private readonly cache = new Map<string, KernelMesh>()
  private readonly inFlightMeshes = new Map<string, Promise<KernelMesh>>()
  private readonly pendingMeshes = new Map<number, { resolve: (mesh: KernelMesh) => void; reject: (error: Error) => void }>()
  private readonly pendingViewportMeshes = new Map<number, { resolve: (result: ViewportMeshResult) => void; reject: (error: Error) => void }>()
  private readonly pendingExports = new Map<number, { format: KernelExportFormat; resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>()
  private readonly pendingProjections = new Map<number, { resolve: (projection: KernelProjection) => void; reject: (error: Error) => void }>()
  private readonly pendingRequestContexts = new Map<number, unknown>()
  private cachedBytes = 0
  private activeRequestId: number | null = null
  private readonly queuedSemanticRequestIds: number[] = []
  private queuedViewportRequestId: number | null = null
  private readonly requests = new Map<number, KernelRequest>()
  private readonly queuedAt = new Map<number, number>()
  private readonly dispatchedAt = new Map<number, number>()

  private onStatusChange?: (status: 'idle' | 'loading' | 'ready' | 'error', message: string) => void
  private readonly workerFactory: () => Worker

  constructor(options?: {
    onStatusChange?: (status: 'idle' | 'loading' | 'ready' | 'error', message: string) => void
    workerFactory?: () => Worker
  }) {
    this.onStatusChange = options?.onStatusChange
    this.workerFactory = options?.workerFactory ?? (() => new Worker(new URL('./exact-kernel.worker.ts', import.meta.url), { type: 'module' }))
  }

  private setStatus(status: 'idle' | 'loading' | 'ready' | 'error', message: string): void {
    this.onStatusChange?.(status, message)
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    this.setStatus('loading', 'Loading OpenCascade…')
    this.worker = this.workerFactory()

    this.worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      const response = event.data
      if (response.timings) {
        recordPerformanceDuration('kernel.worker', response.timings.initializationMs + response.timings.evaluationMs + response.timings.outputMs, {
          output: response.ok ? response.type : 'error',
          initializationMs: response.timings.initializationMs,
          evaluationMs: response.timings.evaluationMs,
          outputMs: response.timings.outputMs,
          responseBytes: response.timings.responseBytes,
        })
      }
      const dispatchedAt = this.dispatchedAt.get(response.id)
      if (dispatchedAt !== undefined) recordPerformance('kernel.roundtrip', dispatchedAt, { output: response.ok ? response.type : 'error' })
      this.dispatchedAt.delete(response.id)
      const meshHandler = this.pendingMeshes.get(response.id)
      const viewportHandler = this.pendingViewportMeshes.get(response.id)
      const exportHandler = this.pendingExports.get(response.id)
      const projectionHandler = this.pendingProjections.get(response.id)

      if (response.ok) {
        this.pendingRequestContexts.delete(response.id)
        this.setStatus('ready', 'OpenCascade exact B-rep')
        if (response.type === 'mesh' && viewportHandler) {
          this.pendingViewportMeshes.delete(response.id)
          viewportHandler.resolve({ status: 'ready', mesh: response.mesh })
        } else if (response.type === 'mesh' && meshHandler) {
          this.pendingMeshes.delete(response.id)
          meshHandler.resolve(response.mesh)
        } else if (response.type === 'projection' && projectionHandler) {
          this.pendingProjections.delete(response.id)
          projectionHandler.resolve({ views: response.views, unresolved: response.unresolved })
        } else if (response.type !== 'mesh' && response.type !== 'projection' && exportHandler) {
          this.pendingExports.delete(response.id)
          exportHandler.resolve(response.bytes)
        }
      } else {
        const message = readableKernelError(response.error)
        logDiagnostic('error', 'Exact geometry', message, {
          rawKernelError: response.error,
          request: this.pendingRequestContexts.get(response.id),
        })
        this.setStatus('error', message)
        this.pendingMeshes.delete(response.id)
        this.pendingViewportMeshes.delete(response.id)
        this.pendingExports.delete(response.id)
        this.pendingProjections.delete(response.id)
        this.pendingRequestContexts.delete(response.id)
        meshHandler?.reject(new Error(message))
        viewportHandler?.reject(new Error(message))
        exportHandler?.reject(new Error(message))
        projectionHandler?.reject(new Error(message))
      }
      this.completeRequest(response.id)
    }

    this.worker.onerror = (event) => {
      const error = new Error(readableKernelError(event.message))
      logDiagnostic('error', 'Exact geometry worker', error.message, { filename: event.filename, line: event.lineno, column: event.colno })
      this.setStatus('error', error.message)
      this.rejectAll(error)
      this.worker?.terminate()
      this.worker = null
    }

    return this.worker
  }

  private rejectAll(error: Error): void {
    for (const handler of this.pendingMeshes.values()) handler.reject(error)
    for (const handler of this.pendingViewportMeshes.values()) handler.reject(error)
    for (const handler of this.pendingExports.values()) handler.reject(error)
    for (const handler of this.pendingProjections.values()) handler.reject(error)
    this.pendingMeshes.clear()
    this.pendingViewportMeshes.clear()
    this.pendingExports.clear()
    this.pendingProjections.clear()
    this.inFlightMeshes.clear()
    this.pendingRequestContexts.clear()
    this.requests.clear()
    this.queuedAt.clear()
    this.dispatchedAt.clear()
    this.queuedSemanticRequestIds.length = 0
    this.queuedViewportRequestId = null
    this.activeRequestId = null
  }

  private enqueue(request: KernelRequest, intent: 'viewport' | 'semantic'): void {
    this.requests.set(request.id, request)
    this.queuedAt.set(request.id, performance.now())
    if (intent === 'viewport') {
      if (this.queuedViewportRequestId !== null) {
        const supersededId = this.queuedViewportRequestId
        this.pendingViewportMeshes.get(supersededId)?.resolve({ status: 'superseded' })
        this.pendingViewportMeshes.delete(supersededId)
        this.pendingRequestContexts.delete(supersededId)
        this.queuedAt.delete(supersededId)
        this.requests.delete(supersededId)
      }
      this.queuedViewportRequestId = request.id
    } else {
      this.queuedSemanticRequestIds.push(request.id)
    }
    this.dispatchNext()
  }

  private dispatchNext(): void {
    if (this.activeRequestId !== null) return
    const nextId = this.queuedSemanticRequestIds.shift() ?? this.queuedViewportRequestId
    if (nextId === null || nextId === undefined) return
    if (this.queuedViewportRequestId === nextId) this.queuedViewportRequestId = null
    const request = this.requests.get(nextId)
    if (!request) {
      this.dispatchNext()
      return
    }
    this.activeRequestId = nextId
    const queuedAt = this.queuedAt.get(nextId)
    if (queuedAt !== undefined) recordPerformance('kernel.queue', queuedAt, { output: request.output })
    this.queuedAt.delete(nextId)
    this.dispatchedAt.set(nextId, performance.now())
    this.getWorker().postMessage(request)
  }

  private completeRequest(id: number): void {
    this.requests.delete(id)
    this.queuedAt.delete(id)
    this.dispatchedAt.delete(id)
    if (this.activeRequestId === id) this.activeRequestId = null
    this.dispatchNext()
  }

  getCachedMesh(operations: KernelOperation[]): KernelMesh | null {
    const key = operationChainCacheKey(operations)
    const mesh = this.cache.get(key)
    if (!mesh) return null
    this.cache.delete(key)
    this.cache.set(key, mesh)
    return mesh
  }

  private storeCachedMesh(key: string, mesh: KernelMesh): void {
    const previous = this.cache.get(key)
    if (previous) this.cachedBytes -= meshBytes(previous)
    this.cache.delete(key)
    this.cache.set(key, mesh)
    this.cachedBytes += meshBytes(mesh)

    while (this.cachedBytes > clientRuntime.policy.kernel.meshCacheBytes && this.cache.size > 1) {
      const oldest = this.cache.entries().next().value as [string, KernelMesh] | undefined
      if (!oldest) break
      this.cache.delete(oldest[0])
      this.cachedBytes -= meshBytes(oldest[1])
    }
  }

  async evaluateMesh(operations: KernelOperation[], describeContext?: unknown): Promise<KernelMesh> {
    const key = operationChainCacheKey(operations)
    const cached = this.getCachedMesh(operations)
    if (cached) {
      this.setStatus('ready', 'OpenCascade exact B-rep (cached)')
      return cached
    }

    const existing = this.inFlightMeshes.get(key)
    if (existing) return existing

    const id = ++this.requestId
    const request: KernelRequest = {
      id,
      type: 'extrude',
      operations,
      output: 'mesh',
    }

    this.pendingRequestContexts.set(id, describeContext)
    this.setStatus('loading', 'Evaluating exact geometry…')

    const result = new Promise<KernelMesh>((resolve, reject) => {
      this.pendingMeshes.set(id, { resolve, reject })
    })

    this.enqueue(request, 'semantic')

    const evaluated = result
      .then((mesh) => {
        this.storeCachedMesh(key, mesh)
        return mesh
      })
      .finally(() => {
        this.inFlightMeshes.delete(key)
      })

    this.inFlightMeshes.set(key, evaluated)
    return evaluated
  }

  async evaluateViewportMesh(operations: KernelOperation[], describeContext?: unknown): Promise<ViewportMeshResult> {
    const cached = this.getCachedMesh(operations)
    if (cached) {
      this.setStatus('ready', 'OpenCascade exact B-rep (cached)')
      return { status: 'ready', mesh: cached }
    }

    const id = ++this.requestId
    const request: KernelRequest = { id, type: 'extrude', operations, output: 'mesh' }
    this.pendingRequestContexts.set(id, describeContext)
    this.setStatus('loading', 'Evaluating exact geometry…')
    const result = new Promise<ViewportMeshResult>((resolve, reject) => {
      this.pendingViewportMeshes.set(id, { resolve, reject })
    })
    this.enqueue(request, 'viewport')
    return result.then((settled) => {
      if (settled.status === 'ready') this.storeCachedMesh(operationChainCacheKey(operations), settled.mesh)
      return settled
    })
  }

  /**
   * Project the evaluated solid into drawing views.
   *
   * Not cached: a projection is asked for when someone opens the drawing sheet,
   * which is rare next to viewport evaluation, and the views depend on options
   * the mesh cache key knows nothing about.
   */
  async evaluateProjection(
    bodies: KernelOperation[][],
    projection: NonNullable<KernelRequest['projection']>,
    describeContext?: unknown,
  ): Promise<KernelProjection> {
    const id = ++this.requestId
    const request: KernelRequest = { id, type: 'extrude', operations: bodies[0] ?? [], bodies, output: 'projection', projection }

    this.pendingRequestContexts.set(id, describeContext)
    const result = new Promise<KernelProjection>((resolve, reject) => {
      this.pendingProjections.set(id, { resolve, reject })
    })

    this.setStatus('loading', 'Projecting drawing views…')
    this.enqueue(request, 'semantic')
    return result
  }

  /** Export one body's chain, or several bodies together as one file. */
  async exportGeometry(bodies: KernelOperation[][], format: KernelExportFormat, describeContext?: unknown): Promise<Blob> {
    const id = ++this.requestId
    const request: KernelRequest = {
      id,
      type: 'extrude',
      operations: bodies[0] ?? [],
      bodies,
      output: format,
    }

    this.pendingRequestContexts.set(id, describeContext)
    const result = new Promise<Uint8Array>((resolve, reject) => {
      this.pendingExports.set(id, { format, resolve, reject })
    })

    this.setStatus('loading', `Preparing ${format.toUpperCase()} export…`)
    this.enqueue(request, 'semantic')

    const bytes = await result
    const mimeType = format === 'step' ? 'model/step' : 'model/stl'
    return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
  }
}
