import { recordPerformance } from './performance'

export type StorageStatus = Readonly<{
  available: boolean
  persisted: boolean | null
  usageBytes: number | null
  quotaBytes: number | null
  usageRatio: number | null
}>

export async function inspectStorage(): Promise<StorageStatus> {
  const startedAt = performance.now()
  if (!navigator.storage) {
    recordPerformance('storage.inspect', startedAt, { available: false })
    return { available: false, persisted: null, usageBytes: null, quotaBytes: null, usageRatio: null }
  }
  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted?.().catch(() => false) ?? Promise.resolve(null),
    navigator.storage.estimate?.().catch(() => ({ usage: undefined, quota: undefined } satisfies StorageEstimate))
      ?? Promise.resolve({ usage: undefined, quota: undefined } satisfies StorageEstimate),
  ])
  const usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null
  const quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null
  const usageRatio = usageBytes !== null && quotaBytes !== null && quotaBytes > 0 ? usageBytes / quotaBytes : null
  recordPerformance('storage.inspect', startedAt, { available: true, persisted: persisted === true })
  return { available: true, persisted, usageBytes, quotaBytes, usageRatio }
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (navigator.storage?.persist) await navigator.storage.persist()
  return inspectStorage()
}
