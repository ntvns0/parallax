import type { Feature, PatternFeature, PatternParameters, Vec3, WorldAxis } from './model'

/**
 * What a pattern copies and where the copies go, without a kernel.
 *
 * A pattern repeats the cuts and bosses of earlier features at its own place
 * in the history. Each copy is the original feature's tool moved by one of
 * the transforms below, then cut or fused the way the original was.
 */

export type PatternTransform =
  | { kind: 'translate'; offset: Vec3 }
  | { kind: 'rotate'; degrees: number; origin: Vec3; axis: Vec3 }
  | { kind: 'mirror'; origin: Vec3; normal: Vec3 }

/** More copies than this is a typing mistake, not a part. */
export const MAX_PATTERN_INSTANCES = 500

const AXES: Record<WorldAxis, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }

export function axisVector(axis: WorldAxis): Vec3 {
  return AXES[axis]
}

/** The features a pattern can copy: anything that makes a cut or a boss from a tool. */
export function isPatternable(feature: Feature): boolean {
  return feature.kind === 'extrude' || feature.kind === 'revolve' || feature.kind === 'hole'
}

/** The features a pattern copies that still exist, come before it, and can be copied. */
export function patternSeeds(pattern: PatternFeature, features: Feature[]): Feature[] {
  const index = features.findIndex((candidate) => candidate.id === pattern.id)
  const earlier = index >= 0 ? features.slice(0, index) : features
  return pattern.featureIds
    .map((id) => earlier.find((candidate) => candidate.id === id))
    .filter((feature): feature is Feature => feature !== undefined && isPatternable(feature))
}

/** How many copies a pattern makes, the originals not counted. */
export function patternCopyCount(parameters: PatternParameters): number {
  if (parameters.pattern === 'mirror') return 1
  if (parameters.pattern === 'circular') return parameters.count - 1
  return parameters.count * Math.max(1, parameters.count2) - 1
}

/** What is wrong with a pattern's numbers, or null. */
export function patternProblem(parameters: PatternParameters): string | null {
  if (parameters.pattern === 'mirror') return null
  if (!Number.isInteger(parameters.count) || parameters.count < 1) return 'A pattern count must be a whole number, at least 1.'
  if (parameters.pattern === 'linear') {
    if (!Number.isInteger(parameters.count2) || parameters.count2 < 1) return 'The second count must be a whole number, at least 1.'
    if (parameters.count > 1 && parameters.spacing === 0) return 'Enter a spacing other than zero.'
    if (parameters.count2 > 1 && parameters.spacing2 === 0) return 'Enter a second spacing other than zero.'
    if (parameters.count2 > 1 && parameters.direction2 === parameters.direction) return 'The two directions of a grid must differ.'
  } else if (!(parameters.angle > 0 && parameters.angle <= 360)) {
    return 'A circular pattern spans more than 0° and at most 360°.'
  }
  if (patternCopyCount(parameters) + 1 > MAX_PATTERN_INSTANCES) return `A pattern makes at most ${MAX_PATTERN_INSTANCES} instances.`
  return null
}

/**
 * Where every copy goes, the original excluded. A circular pattern spread
 * over a full turn spaces its copies evenly round it; over less, the first
 * and last sit at either end of the span.
 */
export function patternTransforms(parameters: PatternParameters): PatternTransform[] {
  if (patternProblem(parameters)) return []
  const direction = axisVector(parameters.direction)
  if (parameters.pattern === 'mirror') return [{ kind: 'mirror', origin: parameters.origin, normal: direction }]
  if (parameters.pattern === 'circular') {
    const step = parameters.angle >= 360 ? 360 / parameters.count : parameters.angle / Math.max(1, parameters.count - 1)
    return Array.from({ length: parameters.count - 1 }, (_, index) => ({
      kind: 'rotate' as const, degrees: step * (index + 1), origin: parameters.origin, axis: direction,
    }))
  }
  const second = axisVector(parameters.direction2)
  const transforms: PatternTransform[] = []
  for (let row = 0; row < Math.max(1, parameters.count2); row += 1) {
    for (let column = 0; column < parameters.count; column += 1) {
      if (row === 0 && column === 0) continue
      const offset = direction.map((value, index) => value * parameters.spacing * column + second[index] * parameters.spacing2 * row + 0) as Vec3
      transforms.push({ kind: 'translate', offset })
    }
  }
  return transforms
}

/** Where a transform puts a point. The kernel moves shapes; this is for checking that it moves them to the same place. */
export function transformPoint(point: Vec3, transform: PatternTransform): Vec3 {
  if (transform.kind === 'translate') return point.map((value, index) => value + transform.offset[index]) as Vec3
  const relative = point.map((value, index) => value - transform.origin[index])
  if (transform.kind === 'mirror') {
    const along = relative.reduce((sum, value, index) => sum + value * transform.normal[index], 0)
    return relative.map((value, index) => value - 2 * along * transform.normal[index] + transform.origin[index]) as Vec3
  }
  const angle = (transform.degrees * Math.PI) / 180
  const [kx, ky, kz] = transform.axis
  const [vx, vy, vz] = relative
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dot = kx * vx + ky * vy + kz * vz
  const cross = [ky * vz - kz * vy, kz * vx - kx * vz, kx * vy - ky * vx]
  return relative.map((value, index) =>
    value * cos + cross[index] * sin + transform.axis[index] * dot * (1 - cos) + transform.origin[index]) as Vec3
}

/** New pattern parameters of each kind, the original at the origin of the copies. */
export function defaultPatternParameters(pattern: PatternParameters['pattern']): PatternParameters {
  return {
    pattern,
    count: pattern === 'circular' ? 6 : 2,
    spacing: 10,
    direction: pattern === 'linear' ? 'X' : pattern === 'circular' ? 'Z' : 'X',
    count2: 1,
    spacing2: 10,
    direction2: 'Y',
    angle: 360,
    origin: [0, 0, 0],
  }
}

/** One line describing a pattern, for the property panel and the drawing. */
export function describePattern(parameters: PatternParameters, format: (millimetres: number) => string): string {
  if (parameters.pattern === 'mirror') {
    const plane = { X: 'YZ', Y: 'XZ', Z: 'XY' }[parameters.direction]
    return `Mirrored across ${plane} at ${format(parameters.origin[{ X: 0, Y: 1, Z: 2 }[parameters.direction]])}`
  }
  if (parameters.pattern === 'circular') {
    return `${parameters.count} × ${parameters.angle >= 360 ? 'round' : `over ${parameters.angle}°`} ${parameters.direction}`
  }
  const row = `${parameters.count} × ${format(parameters.spacing)} along ${parameters.direction}`
  return parameters.count2 > 1 ? `${row}, ${parameters.count2} × ${format(parameters.spacing2)} along ${parameters.direction2}` : row
}
