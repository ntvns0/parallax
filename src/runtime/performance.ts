import { clientRuntime } from './client-runtime'

export type PerformanceEventName =
  | 'app.start'
  | 'kernel.queue'
  | 'kernel.roundtrip'
  | 'kernel.worker'
  | 'storage.inspect'
  | 'webgl.context-lost'
  | 'webgl.context-restored'

type PerformanceAttributes = Readonly<Record<string, string | number | boolean>>

export type PerformanceEvent = Readonly<{
  name: PerformanceEventName
  startedAt: number
  durationMs: number
  attributes: PerformanceAttributes
}>

const MAX_EVENTS = 500
const events: PerformanceEvent[] = []

export function recordPerformance(
  name: PerformanceEventName,
  startedAt: number,
  attributes: PerformanceAttributes = {},
): void {
  const safeAttributes = Object.fromEntries(Object.entries(attributes).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
  events.push({ name, startedAt, durationMs: Math.max(0, performance.now() - startedAt), attributes: safeAttributes })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

export function recordPerformanceDuration(
  name: PerformanceEventName,
  durationMs: number,
  attributes: PerformanceAttributes = {},
): void {
  const safeAttributes = Object.fromEntries(Object.entries(attributes).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
  events.push({ name, startedAt: performance.now(), durationMs: Math.max(0, durationMs), attributes: safeAttributes })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

export function clearPerformanceReport(): void {
  events.length = 0
}

export function performanceReport() {
  return {
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    runtime: clientRuntime,
    events: [...events],
  }
}

export function downloadPerformanceReport(): void {
  const blob = new Blob([JSON.stringify(performanceReport(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `parallax-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
