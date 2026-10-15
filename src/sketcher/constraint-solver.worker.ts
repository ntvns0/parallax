/// <reference lib="webworker" />

import { GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs'
import planeGcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'
import type { ConstraintRequest, ConstraintResponse } from './constraint-types'
import { solveWithPlaneGcs } from './planegcs-solve'

let wrapperPromise: Promise<GcsWrapper> | null = null

function getWrapper() {
  if (!wrapperPromise) {
    wrapperPromise = (async () => {
      const module = await init_planegcs_module({ locateFile: () => planeGcsWasm })
      return new GcsWrapper(new module.GcsSystem(), module)
    })()
  }
  return wrapperPromise
}

self.onmessage = async (event: MessageEvent<ConstraintRequest>) => {
  const request = event.data
  try {
    self.postMessage(solveWithPlaneGcs(await getWrapper(), request))
  } catch (error) {
    const response: ConstraintResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
