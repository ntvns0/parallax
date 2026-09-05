import { describe, expect, it } from 'vitest'
import { KernelClient } from './kernel-client'
import { operationChainCacheKey } from './operation-chain'
import type { KernelMesh, KernelOperation, KernelRequest, KernelResponse } from './kernel-types'

class FakeWorker {
  onmessage: ((event: MessageEvent<KernelResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: KernelRequest[] = []

  postMessage(request: KernelRequest) {
    this.posted.push(request)
  }

  respond(response: KernelResponse) {
    this.onmessage?.({ data: response } as MessageEvent<KernelResponse>)
  }

  terminate() {}
}

function operation(distance: number): KernelOperation {
  return {
    type: 'extrude', featureId: `ext-${distance}`, featureName: `Extrude ${distance}`,
    sketchId: 'sk-1', regions: [], plane: 'XY', planeOffset: 0, distance,
    symmetric: false, operation: 'newBody', edgeRadius: 0,
  }
}

function mesh(): KernelMesh {
  return {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    triangles: new Uint32Array([0, 1, 2]),
    faceGroups: [], edgeLines: new Float32Array(), edgeGroups: [], unresolved: [],
  }
}

describe('KernelClient cache key isolation', () => {
  it('generates identical cache keys when featureName changes', () => {
    const op1: KernelOperation = {
      type: 'extrude',
      featureId: 'ext-1',
      featureName: 'Extrude 1',
      sketchId: 'sk-1',
      regions: [],
      plane: 'XY',
      planeOffset: 0,
      distance: 10,
      symmetric: false,
      operation: 'newBody',
      edgeRadius: 0,
    }

    const op2: KernelOperation = {
      ...op1,
      featureName: 'Renamed Feature',
    }

    expect(operationChainCacheKey([op1])).toBe(operationChainCacheKey([op2]))
  })

  it('generates different cache keys when geometry changes', () => {
    const op1: KernelOperation = {
      type: 'extrude',
      featureId: 'ext-1',
      featureName: 'Extrude 1',
      sketchId: 'sk-1',
      regions: [],
      plane: 'XY',
      planeOffset: 0,
      distance: 10,
      symmetric: false,
      operation: 'newBody',
      edgeRadius: 0,
    }

    const op2: KernelOperation = {
      ...op1,
      distance: 25,
    }

    expect(operationChainCacheKey([op1])).not.toBe(operationChainCacheKey([op2]))
  })
})

describe('KernelClient scheduling', () => {
  it('keeps durable work and only dispatches the newest waiting viewport mesh', async () => {
    const worker = new FakeWorker()
    const client = new KernelClient({ workerFactory: () => worker as unknown as Worker })

    const first = client.evaluateViewportMesh([operation(1)])
    const superseded = client.evaluateViewportMesh([operation(2)])
    const latest = client.evaluateViewportMesh([operation(3)])
    const durable = client.evaluateMesh([operation(4)])

    await expect(superseded).resolves.toEqual({ status: 'superseded' })
    expect(worker.posted.map((request) => request.operations[0]?.featureId)).toEqual(['ext-1'])

    worker.respond({ id: worker.posted[0].id, ok: true, type: 'mesh', mesh: mesh() })
    await expect(first).resolves.toMatchObject({ status: 'ready' })
    expect(worker.posted.map((request) => request.operations[0]?.featureId)).toEqual(['ext-1', 'ext-4'])

    worker.respond({ id: worker.posted[1].id, ok: true, type: 'mesh', mesh: mesh() })
    await expect(durable).resolves.toBeDefined()
    expect(worker.posted.map((request) => request.operations[0]?.featureId)).toEqual(['ext-1', 'ext-4', 'ext-3'])

    worker.respond({ id: worker.posted[2].id, ok: true, type: 'mesh', mesh: mesh() })
    await expect(latest).resolves.toMatchObject({ status: 'ready' })
  })
})
