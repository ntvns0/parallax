/**
 * Finding out how large a fillet the geometry will actually take.
 *
 * A fillet that is too big for the face it sits on makes OpenCascade fail with
 * a bare numeric status code, which tells a user nothing except that something
 * went wrong. Worse, it used to fail the whole evaluation, so one radius typed
 * a millimetre too large cost the entire part until it was typed back.
 *
 * Both problems have the same answer: when the requested radius is refused,
 * search for one that is accepted and report it. The user gets a number to type
 * instead of a status code, and the rest of the model keeps building.
 *
 * The search is kept apart from the worker so it can be tested against a
 * predicate rather than against WebAssembly.
 */

/** How close the search gets to the true limit before stopping, as a fraction. */
export const FILLET_SCALE_TOLERANCE = 0.01

/**
 * The largest fraction of the requested radii that `accepts` allows, in [0, 1).
 *
 * Bisection assumes a radius that fails also fails at every larger size. That
 * is not a theorem — OpenCascade's blend can fail for reasons unrelated to size
 * — but it holds for the case this exists to explain, where the blend runs out
 * of face to sit on. Everything reported from it is described as approximate
 * for that reason.
 *
 * Returns 0 when nothing short of vanishing works, which means the trouble is
 * the edge selection rather than the radius.
 */
export function largestWorkingScale(accepts: (scale: number) => boolean): number {
  let works = 0
  let fails = 1

  while (fails - works > FILLET_SCALE_TOLERANCE) {
    const middle = (works + fails) / 2
    if (accepts(middle)) works = middle
    else fails = middle
  }
  return works
}

/**
 * Plain-language account of a fillet that is simply too big.
 *
 * `scale` is what `largestWorkingScale` found. The radius quoted back is
 * deliberately the one known to work rather than the boundary itself, so
 * typing it in succeeds.
 */
export function describeOversizedFillet(
  featureName: string,
  radius: number,
  scale: number,
  groupSize: number,
): string {
  const together = groupSize > 1 ? ' with the other fillets it meets' : ''
  if (scale < FILLET_SCALE_TOLERANCE * 2) {
    return `${featureName} could not be built at any radius${together}. The selected edges probably do not all meet at a corner — select every sharp edge that meets there together, or remove this fillet.`
  }
  const limit = radius * scale
  const rounded = limit >= 1 ? limit.toFixed(2) : limit.toFixed(3)
  return `${featureName} is too large for the geometry it sits on${together}: a ${formatMillimetres(radius)} mm radius leaves no room for the blend. The largest that works here is about ${rounded} mm.`
}

function formatMillimetres(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
