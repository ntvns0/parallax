export type ClientFacts = Readonly<{
  logicalProcessors: number | null
  deviceMemoryGiB: number | null
  reducedMotion: boolean
  coarsePointer: boolean
  crossOriginIsolated: boolean
  sharedArrayBuffer: boolean
  opfs: boolean
}>

export type ClientPolicy = Readonly<{
  profile: 'conservative' | 'balanced' | 'capable'
  render: { maxPixelRatio: number; ambientOcclusionSamples: number }
  kernel: { meshCacheBytes: number }
}>

export type ClientRuntime = Readonly<{ facts: ClientFacts; policy: ClientPolicy }>

function mediaMatches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches
}

export function readClientFacts(): ClientFacts {
  const memory = 'deviceMemory' in navigator ? Number(navigator.deviceMemory) : Number.NaN
  return {
    logicalProcessors: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null,
    deviceMemoryGiB: Number.isFinite(memory) ? memory : null,
    reducedMotion: mediaMatches('(prefers-reduced-motion: reduce)'),
    coarsePointer: mediaMatches('(pointer: coarse)'),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    opfs: typeof navigator.storage?.getDirectory === 'function',
  }
}

export function deriveClientPolicy(facts: ClientFacts): ClientPolicy {
  const constrainedCpu = facts.logicalProcessors !== null && facts.logicalProcessors <= 4
  const constrainedMemory = facts.deviceMemoryGiB !== null && facts.deviceMemoryGiB <= 4
  const capableCpu = facts.logicalProcessors !== null && facts.logicalProcessors >= 8
  const capableMemory = facts.deviceMemoryGiB !== null && facts.deviceMemoryGiB >= 8
  if (constrainedCpu || constrainedMemory) {
    return {
      profile: 'conservative',
      render: { maxPixelRatio: 1, ambientOcclusionSamples: 8 },
      kernel: { meshCacheBytes: 48 * 1024 * 1024 },
    }
  }
  if (capableCpu && capableMemory) {
    return {
      profile: 'capable',
      render: { maxPixelRatio: 2, ambientOcclusionSamples: 16 },
      kernel: { meshCacheBytes: 128 * 1024 * 1024 },
    }
  }
  return {
    profile: 'balanced',
    render: { maxPixelRatio: 1.5, ambientOcclusionSamples: 12 },
    kernel: { meshCacheBytes: 96 * 1024 * 1024 },
  }
}

export const clientRuntime: ClientRuntime = (() => {
  const facts = readClientFacts()
  return { facts, policy: deriveClientPolicy(facts) }
})()

export async function startClientRuntime(): Promise<ClientRuntime> {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.register('/service-worker.js')
    const announceUpdate = () => window.dispatchEvent(new CustomEvent('parallax:update-ready'))
    if (registration.waiting) announceUpdate()
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', () => {
        if (registration.waiting && navigator.serviceWorker.controller) announceUpdate()
      })
    })
  }
  return clientRuntime
}

export async function activateClientUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration?.waiting) return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' })
}
