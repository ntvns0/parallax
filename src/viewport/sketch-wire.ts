import type { SketchFeature, Vec3 } from '../core/model'

/**
 * A finished sketch as line-segment positions in world space, for drawing it
 * in the scene. Circles and arcs are cut into segments in proportion to how
 * far round they go, 96 to a full turn and never fewer than 8.
 */
export function sketchWirePositions(sketch: SketchFeature): number[] {
  const offset = sketch.parameters.planeOffset
  const world = (u: number, v: number): Vec3 => {
    if (sketch.plane === 'XZ') return [u, -offset, v]
    if (sketch.plane === 'YZ') return [offset, u, v]
    return [u, v, offset]
  }
  const positions: number[] = []
  for (const entity of sketch.entities) {
    if (entity.type === 'line') {
      positions.push(...world(...entity.start), ...world(...entity.end))
      continue
    }
    // A circle is the whole turn; an arc is only the part it sweeps, so both
    // are drawn from a start angle and a span.
    const from = entity.type === 'arc' ? entity.startAngle : 0
    const span = entity.type === 'arc' ? entity.endAngle - entity.startAngle : Math.PI * 2
    const segments = Math.max(8, Math.ceil((96 * span) / (Math.PI * 2)))
    const at = (index: number) => {
      const angle = from + (index / segments) * span
      return world(entity.center[0] + Math.cos(angle) * entity.radius, entity.center[1] + Math.sin(angle) * entity.radius)
    }
    for (let index = 0; index < segments; index += 1) positions.push(...at(index), ...at(index + 1))
  }
  return positions
}
