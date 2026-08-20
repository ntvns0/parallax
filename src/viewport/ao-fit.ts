/**
 * How far ambient occlusion reaches, for a part of a given size.
 *
 * Occlusion radius is a world-space distance, so a value that reads correctly on
 * a 200 mm bracket turns a 5 mm insert solid black and leaves a 2 m frame with
 * no shading at all. Scaling it with the part keeps the *proportion* of the
 * model that darkens constant, which is what makes the effect describe form
 * rather than size.
 *
 * The fraction is deliberately small. Ambient occlusion here is meant to seat
 * pockets and fillets into the surfaces around them, not to look atmospheric —
 * a technical view is easier to measure by eye when shading stays close to the
 * geometry that causes it.
 */
const RADIUS_FRACTION = 0.06

/** Below this the pass costs more than it shows; above it, AO smears. */
const MIN_RADIUS_MM = 0.05
const MAX_RADIUS_MM = 40

export function ambientOcclusionRadius(modelRadius: number): number {
  if (!Number.isFinite(modelRadius) || modelRadius <= 0) return MIN_RADIUS_MM
  return Math.min(MAX_RADIUS_MM, Math.max(MIN_RADIUS_MM, modelRadius * RADIUS_FRACTION))
}
