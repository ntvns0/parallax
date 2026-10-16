/// <reference lib="webworker" />

import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import openCascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import { setOC, type Shape3D } from 'replicad'
import type { KernelRequest, KernelResponse, KernelWorkerTimings } from './kernel-types'
import { evaluateBodies, evaluateOperations, step } from './evaluate-chain'
import { projectViews } from './projection'

let initialization: Promise<void> | null = null
let initializationDurationMs = 0

function initialize() {
  if (!initialization) {
    initialization = (async () => {
      const startedAt = performance.now()
      const init = initOpenCascade as unknown as (config: { locateFile: () => string }) => Promise<Parameters<typeof setOC>[0]>
      const oc = await init({ locateFile: () => openCascadeWasm })
      setOC(oc)
      initializationDurationMs = performance.now() - startedAt
    })()
  }
  return initialization
}

function transferableMesh(values: {
  vertices: number[]
  normals: number[]
  triangles: number[]
  edgeLines: number[]
}) {
  if (values.vertices.length % 3 !== 0 || values.normals.length !== values.vertices.length) {
    throw new Error('OpenCascade returned malformed vertex or normal data.')
  }
  if (values.edgeLines.length % 3 !== 0) throw new Error('OpenCascade returned malformed edge data.')
  const vertexCount = values.vertices.length / 3
  for (const index of values.triangles) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount || index > 0xffff_ffff) {
      throw new Error('OpenCascade returned an invalid triangle index.')
    }
  }
  return {
    vertices: new Float32Array(values.vertices),
    normals: new Float32Array(values.normals),
    triangles: new Uint32Array(values.triangles),
    edgeLines: new Float32Array(values.edgeLines),
  }
}

/**
 * Requests run one at a time.
 *
 * The prefix cache hands out solids it still owns and frees them on eviction,
 * so two requests interleaving at an `await` could let one evict a shape the
 * other is still holding. OpenCascade work is CPU-bound and was never actually
 * concurrent, so serializing costs nothing and removes the hazard entirely.
 */
let queue: Promise<void> = Promise.resolve()

self.onmessage = (event: MessageEvent<KernelRequest>) => {
  queue = queue.then(() => handle(event.data))
}

async function handle(request: KernelRequest): Promise<void> {
  let shape: Shape3D | null = null
  let release = () => {}
  let evaluationMs = 0
  let requestInitializationMs = 0
  let outputStartedAt = performance.now()
  let responseBytes = 0
  const timings = (): KernelWorkerTimings => ({
    initializationMs: requestInitializationMs,
    evaluationMs,
    outputMs: performance.now() - outputStartedAt,
    responseBytes,
  })
  try {
    const wasInitialized = initialization !== null
    await initialize()
    requestInitializationMs = wasInitialized ? 0 : initializationDurationMs
    const evaluationStartedAt = performance.now()
    // Several bodies are only ever exported or drawn together; the viewport
    // asks for each body's mesh on its own.
    const evaluation = request.bodies && request.bodies.length > 1 && request.output !== 'mesh'
      ? evaluateBodies(request.bodies)
      : evaluateOperations(request.operations)
    evaluationMs = performance.now() - evaluationStartedAt
    outputStartedAt = performance.now()
    shape = evaluation.shape
    release = evaluation.release
    const { unresolved } = evaluation

    if (request.output === 'projection') {
      const solid: Shape3D = shape
      const projection = request.projection ?? { views: ['front', 'top', 'right', 'iso'], hiddenLines: true }
      const views = step('project', () => projectViews(solid, projection.views, projection.hiddenLines, projection.section))
      const response: KernelResponse = { id: request.id, ok: true, type: 'projection', views, unresolved, timings: timings() }
      self.postMessage(response)
      return
    }

    if (request.output !== 'mesh') {
      const blob = request.output === 'step'
        ? shape.blobSTEP()
        : shape.blobSTL({ tolerance: 0.02, angularTolerance: 0.08, binary: true })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      responseBytes = bytes.byteLength
      const response: KernelResponse = { id: request.id, ok: true, type: request.output, bytes, timings: timings() }
      self.postMessage(response, { transfer: [bytes.buffer] })
      return
    }

    const mesh = shape.mesh({ tolerance: 0.02, angularTolerance: 0.08 })
    const edges = shape.meshEdges({ tolerance: 0.02, angularTolerance: 0.08 })
    if (!mesh.vertices.length || !mesh.triangles.length) {
      throw new Error('The selected-edge fillet produced an empty solid. Reduce the radius or choose a different edge.')
    }
    const arrays = transferableMesh({
      vertices: mesh.vertices,
      normals: mesh.normals,
      triangles: mesh.triangles,
      edgeLines: edges.lines,
    })
    const response: KernelResponse = {
      id: request.id,
      ok: true,
      type: 'mesh',
      mesh: {
        vertices: arrays.vertices,
        normals: arrays.normals,
        triangles: arrays.triangles,
        faceGroups: mesh.faceGroups,
        edgeLines: arrays.edgeLines,
        edgeGroups: edges.edgeGroups,
        unresolved,
      },
      timings: (() => {
        responseBytes = arrays.vertices.byteLength + arrays.normals.byteLength + arrays.triangles.byteLength + arrays.edgeLines.byteLength
        return timings()
      })(),
    }
    self.postMessage(response, {
      transfer: [arrays.vertices.buffer, arrays.normals.buffer, arrays.triangles.buffer, arrays.edgeLines.buffer],
    })
  } catch (error) {
    const response: KernelResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      timings: timings(),
    }
    self.postMessage(response)
  } finally {
    // A shape the prefix cache still owns outlives this request; anything else
    // is this request's to free, on every exit path including the failures.
    release()
  }
}
