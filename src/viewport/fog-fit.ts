/**
 * Atmospheric depth that means the same thing at every part size.
 *
 * Exponential fog fades a surface by `1 - exp(-(density * depth)^2)`, so a
 * density fixed in world units only reads correctly at one scale. At 0.0015 a
 * part viewed from 200 units away lost 9% to fog — a pleasant depth cue — while
 * the same part scaled up and viewed from 1070 lost 92% and was
 * indistinguishable from the background. That is what made large parts look
 * unlit: they were not dark, they were faded out.
 *
 * Tying density to the model's size instead fixes the fade at the framing
 * distance, so fog reads as depth rather than as a size-dependent dimmer.
 */

/** How much of the part is lost to fog when it is framed in the viewport. */
const FADE_WHEN_FRAMED = 0.12

/**
 * Framing distance as a multiple of the model radius, from the camera fit:
 * radius * margin / sin(halfFov) with the viewport's 38 degree field.
 */
const FRAMING_DISTANCE_PER_RADIUS = 3.62

export function fogDensityForRadius(modelRadius: number): number {
  const radius = Math.max(Number.isFinite(modelRadius) ? modelRadius : 0, 0.001)
  // Invert the fog curve for the fade wanted at the framing distance.
  const depth = radius * FRAMING_DISTANCE_PER_RADIUS
  return Math.sqrt(-Math.log(1 - FADE_WHEN_FRAMED)) / depth
}
