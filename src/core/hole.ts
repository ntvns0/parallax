import { currentPlaneOffset } from './face-anchor'
import type { Feature, HoleFeature, HoleForm, HoleParameters, SketchFeature, SketchPlane, Vec2, Vec3 } from './model'
import { sketchPointToWorld } from './sketch-plane'

/**
 * What a Hole feature drills, worked out without a kernel.
 *
 * A hole goes at every non-construction point of its sketch, and runs into the
 * material: against a face sketch's outward normal, or against a base-plane
 * sketch's own normal. Its shape is one half-section, revolved about the hole's
 * axis, for every form — a counterbore and a countersink are only different
 * outlines of the same section.
 */

/** Where one hole starts on the surface, and the unit direction it drills in. */
export type HolePlacement = { pointId: string; origin: Vec3; direction: Vec3 }

/**
 * How far above the surface the cutting tool starts. A tool that starts
 * exactly on the face shares that face with the solid, and a boolean on
 * coincident faces is where OpenCascade is least reliable.
 */
export const HOLE_OVERSHOOT_MM = 0.5

/** The world direction a sketch plane's offset grows in. See `sketch-plane.ts` for the -Y. */
function planeNormal(plane: SketchPlane): Vec3 {
  if (plane === 'XZ') return [0, -1, 0]
  if (plane === 'YZ') return [1, 0, 0]
  return [0, 0, 1]
}

export function holePlacements(hole: HoleFeature, features: Feature[]): HolePlacement[] {
  const sketch = features.find((candidate): candidate is SketchFeature => candidate.id === hole.sketchId && candidate.kind === 'sketch')
  if (!sketch) return []
  const offset = currentPlaneOffset(sketch, features)
  const into = -(sketch.parameters.faceNormalSign ?? 1)
  const direction = planeNormal(sketch.plane).map((value) => value * into + 0) as Vec3
  return sketch.entities.flatMap((entity) => entity.type === 'point' && !entity.construction
    ? [{ pointId: entity.id, origin: sketchPointToWorld(sketch.plane, entity.position, offset), direction }]
    : [])
}

/** How deep a countersink's cone goes before it meets the bore. */
export function countersinkDepth(parameters: Pick<HoleParameters, 'diameter' | 'headDiameter' | 'countersinkAngle'>): number {
  const halfAngle = (parameters.countersinkAngle * Math.PI) / 360
  return Math.max(0, (parameters.headDiameter - parameters.diameter) / 2 / Math.tan(halfAngle))
}

/**
 * The half-section of one hole, as [distance out from the axis, depth below
 * the surface], to be revolved. It runs down the axis and back up the wall,
 * and starts `HOLE_OVERSHOOT_MM` above the surface.
 */
export function holeSection(parameters: HoleParameters, depth: number): Vec2[] {
  const r = parameters.diameter / 2
  const head = parameters.headDiameter / 2
  const top = -HOLE_OVERSHOOT_MM
  const wall: Vec2[] = parameters.form === 'counterbore'
    ? [[head, top], [head, parameters.headDepth], [r, parameters.headDepth], [r, depth]]
    : parameters.form === 'countersink'
      ? [[head, top], [head, 0], [r, countersinkDepth(parameters)], [r, depth]]
      : [[r, top], [r, depth]]
  return [[0, top], ...wall, [0, depth]]
}

/** The material a hole removes below the surface, by hand, for tests. */
export function holeVolume(parameters: HoleParameters, depth: number): number {
  const r = parameters.diameter / 2
  const head = parameters.headDiameter / 2
  if (parameters.form === 'counterbore') return Math.PI * (head * head * parameters.headDepth + r * r * (depth - parameters.headDepth))
  if (parameters.form === 'countersink') {
    const cone = countersinkDepth(parameters)
    return Math.PI * cone * (head * head + head * r + r * r) / 3 + Math.PI * r * r * (depth - cone)
  }
  return Math.PI * r * r * depth
}

/** What is wrong with a hole's sizes, or null. Read by the kernel step and the property panel alike. */
export function holeProblem(parameters: HoleParameters): string | null {
  if (!(parameters.diameter > 0)) return 'Enter a hole diameter greater than zero.'
  if (!parameters.through && !(parameters.depth > 0)) return 'Enter a hole depth greater than zero.'
  if (parameters.form === 'simple') return null
  if (!(parameters.headDiameter > parameters.diameter)) return `A ${parameters.form}'s diameter must be larger than the hole's.`
  const headDepth = parameters.form === 'counterbore' ? parameters.headDepth : countersinkDepth(parameters)
  if (parameters.form === 'counterbore' && !(headDepth > 0)) return 'Enter a counterbore depth greater than zero.'
  if (!parameters.through && headDepth >= parameters.depth) return `The ${parameters.form} is as deep as the hole.`
  return null
}

const FORM_SYMBOLS: Record<HoleForm, string> = { simple: '', counterbore: '⌴', countersink: '⌵' }

/** A drawing-style callout: "Ø3.4 THRU ⌴ Ø6.5 ↧ 3.4". */
export function holeCallout(parameters: HoleParameters, format: (millimetres: number) => string): string {
  const bore = `Ø${format(parameters.diameter)} ${parameters.through ? 'THRU' : `↧ ${format(parameters.depth)}`}`
  if (parameters.form === 'counterbore') return `${bore} ${FORM_SYMBOLS.counterbore} Ø${format(parameters.headDiameter)} ↧ ${format(parameters.headDepth)}`
  if (parameters.form === 'countersink') return `${bore} ${FORM_SYMBOLS.countersink} Ø${format(parameters.headDiameter)} × ${parameters.countersinkAngle}°`
  return bore
}

export type HolePreset = { name: string; parameters: Omit<HoleParameters, 'preset' | 'through' | 'depth'> & { depth?: number } }

/**
 * Sizes for printed parts. Clearance bores are the ISO 273 medium fit;
 * counterbores fit ISO 4762 socket head cap screws, and countersinks ISO 10642
 * flat heads, each with a little room for a print's shrinkage. Insert bores
 * are the usual sizes for brass heat-set inserts, which vary by maker — check
 * the insert's datasheet before printing many.
 */
export const HOLE_PRESETS: readonly HolePreset[] = [
  ...([
    ['M2', 2.4, 4.4, 2.2, 4.4],
    ['M2.5', 2.9, 5.5, 2.7, 5.5],
    ['M3', 3.4, 6.5, 3.3, 6.5],
    ['M4', 4.5, 8.0, 4.4, 8.6],
    ['M5', 5.5, 10.0, 5.4, 10.4],
  ] as const).flatMap(([size, clearance, counterbore, counterboreDepth, countersink]): HolePreset[] => [
    { name: `${size} clearance`, parameters: { form: 'simple', diameter: clearance, headDiameter: counterbore, headDepth: counterboreDepth, countersinkAngle: 90 } },
    { name: `${size} counterbore`, parameters: { form: 'counterbore', diameter: clearance, headDiameter: counterbore, headDepth: counterboreDepth, countersinkAngle: 90 } },
    { name: `${size} countersink`, parameters: { form: 'countersink', diameter: clearance, headDiameter: countersink, headDepth: counterboreDepth, countersinkAngle: 90 } },
  ]),
  ...([
    ['M2', 3.2, 4],
    ['M2.5', 3.6, 5],
    ['M3', 4.0, 6],
    ['M4', 5.6, 8],
    ['M5', 6.4, 10],
  ] as const).map(([size, bore, depth]): HolePreset => ({
    name: `${size} heat-set insert`,
    parameters: { form: 'simple', diameter: bore, depth, headDiameter: bore + 2, headDepth: 1, countersinkAngle: 90 },
  })),
]

/** A hole's parameters sized from a preset, keeping its depth unless the preset sets one. */
export function applyHolePreset(current: HoleParameters, presetName: string): HoleParameters {
  const preset = HOLE_PRESETS.find((candidate) => candidate.name === presetName)
  if (!preset) return current
  const { depth, ...sizes } = preset.parameters
  return { ...current, ...sizes, ...(depth !== undefined ? { depth, through: false } : {}), preset: preset.name }
}

/** A new hole's parameters: an M3 clearance hole through the part. */
export function defaultHoleParameters(): HoleParameters {
  return applyHolePreset({ form: 'simple', diameter: 3.4, depth: 10, through: true, headDiameter: 6.5, headDepth: 3.3, countersinkAngle: 90 }, 'M3 clearance')
}
