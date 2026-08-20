import type { BoxParameters, CylinderParameters, DocumentParameter, Feature, SphereParameters } from '../core/model'
import { resolveParameterTable } from '../core/parameters'
import type { ParameterRow } from './sheet-furniture'

/**
 * The driving parameters of the model, as printed on the sheet.
 *
 * A dimensioned view records what the part measures. This records which of
 * those measurements the model is actually driven by, so whoever reads the
 * drawing knows which numbers can be changed and rebuilt rather than re-drawn.
 *
 * Sketches are left out: their geometry is already described, exactly, by the
 * views themselves.
 */
export function describeModelParameters(
  features: Feature[],
  formatValue: (mm: number) => string,
  parameters: DocumentParameter[] = [],
): ParameterRow[] {
  const rows: ParameterRow[] = []

  // Named parameters lead the table. They are the part's real inputs — the
  // feature rows below them are often derived from these — so a machinist
  // reading the sheet sees what the designer intended to be adjustable first.
  // The formula is printed beside the value, because "24" and "plate*2 = 24"
  // are different pieces of information about the same part.
  for (const entry of resolveParameterTable(parameters).entries) {
    const isLiteral = /^\s*-?(?:\d+\.?\d*|\.\d+)\s*$/.test(entry.parameter.expression)
    rows.push({
      label: entry.parameter.name,
      value: entry.value === null
        ? `${entry.parameter.expression} (unresolved)`
        : isLiteral
          ? formatValue(entry.value)
          : `${entry.parameter.expression} = ${formatValue(entry.value)}`,
    })
  }

  for (const feature of features) {
    switch (feature.kind) {
      // The primitive kinds share one parameter union in the document model, so
      // the kind tag does not narrow it. The pairing is guaranteed by
      // `createFeature`, which is the only thing that builds these.
      case 'box': {
        const { width, depth, height } = feature.parameters as BoxParameters
        rows.push({ label: `${feature.name} W×D×H`, value: [width, depth, height].map(formatValue).join('×') })
        break
      }
      case 'cylinder': {
        const { radius, height } = feature.parameters as CylinderParameters
        rows.push({ label: `${feature.name} Ø`, value: formatValue(radius * 2) })
        rows.push({ label: `${feature.name} height`, value: formatValue(height) })
        break
      }
      case 'sphere':
        rows.push({ label: `${feature.name} Ø`, value: formatValue((feature.parameters as SphereParameters).radius * 2) })
        break
      case 'extrude': {
        const suffix = feature.operation === 'cut' ? ' (cut)' : feature.operation === 'add' ? ' (add)' : ''
        rows.push({ label: `${feature.name} depth${suffix}`, value: formatValue(feature.parameters.distance) })
        if (feature.parameters.edgeRadius > 0) {
          rows.push({ label: `${feature.name} edge R`, value: formatValue(feature.parameters.edgeRadius) })
        }
        break
      }
      case 'revolve':
        rows.push({ label: `${feature.name} angle`, value: `${Math.round(feature.parameters.angle * 10) / 10}°` })
        break
      case 'fillet':
        rows.push({ label: `${feature.name} radius`, value: `R${formatValue(feature.parameters.radius)}` })
        break
      case 'sketch':
        break
    }
  }

  return rows
}

/** Distinct fillet radii in the model, largest first, for the notes block. */
export function filletRadii(features: Feature[]): number[] {
  const radii = new Set<number>()
  for (const feature of features) {
    if (feature.kind === 'fillet') radii.add(feature.parameters.radius)
    if (feature.kind === 'extrude' && feature.parameters.edgeRadius > 0) radii.add(feature.parameters.edgeRadius)
  }
  return [...radii].sort((a, b) => b - a)
}
