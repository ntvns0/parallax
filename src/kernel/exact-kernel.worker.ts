/// <reference lib="webworker" />

import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import openCascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import { setOC, type Shape3D } from 'replicad'
import type { KernelRequest, KernelResponse } from './kernel-types'
import { evaluateOperations, step } from './evaluate-chain'
import { projectViews } from './projection'

let initialization: Promise<void> | null = null

function initialize() {
  if (!initialization) {
    initialization = (async () => {
      const init = initOpenCascade as unknown as (config: { locateFile: () => string }) => Promise<Parameters<typeof setOC>[0]>
      const oc = await init({ locateFile: () => openCascadeWasm })
      setOC(oc)
    })()
  }
  return initialization
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
  try {
    await initialize()
    const evaluation = evaluateOperations(request.operations)
    shape = evaluation.shape
    release = evaluation.release
    const { unresolved } = evaluation

    if (request.output === 'projection') {
      const solid: Shape3D = shape
      const projection = request.projection ?? { views: ['front', 'top', 'right', 'iso'], hiddenLines: true }
      const views = step('project', () => projectViews(solid, projection.views, projection.hiddenLines, projection.section))
      const response: KernelResponse = { id: request.id, ok: true, type: 'projection', views, unresolved }
      self.postMessage(response)
      return
    }

    if (request.output !== 'mesh') {
      const blob = request.output === 'step'
        ? shape.blobSTEP()
        : shape.blobSTL({ tolerance: 0.02, angularTolerance: 0.08, binary: true })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const response: KernelResponse = { id: request.id, ok: true, type: request.output, bytes }
      self.postMessage(response, { transfer: [bytes.buffer] })
      return
    }

    const mesh = shape.mesh({ tolerance: 0.02, angularTolerance: 0.08 })
    const edges = shape.meshEdges({ tolerance: 0.02, angularTolerance: 0.08 })
    if (!mesh.vertices.length || !mesh.triangles.length) {
      throw new Error('The selected-edge fillet produced an empty solid. Reduce the radius or choose a different edge.')
    }
    const response: KernelResponse = {
      id: request.id,
      ok: true,
      type: 'mesh',
      mesh: {
        vertices: mesh.vertices,
        normals: mesh.normals,
        triangles: mesh.triangles,
        faceGroups: mesh.faceGroups,
        edgeLines: edges.lines,
        edgeGroups: edges.edgeGroups,
        unresolved,
      },
    }
    self.postMessage(response)
  } catch (error) {
    const response: KernelResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  } finally {
    // A shape the prefix cache still owns outlives this request; anything else
    // is this request's to free, on every exit path including the failures.
    release()
  }
}
