/**
 * Framing a part in the viewport, from whatever direction it is being viewed.
 *
 * Fitting has to hold for any camera orientation, not just the preset views, so
 * it is expressed against the model's bounding *sphere*. A sphere looks the
 * same from every direction, which means one distance works for an isometric
 * view and a top view alike — no per-view special cases, and no part that fits
 * head-on but falls off the edges when orbited.
 */

export type CameraFit = {
  /** How far the camera should sit from the centre of the part. */
  distance: number
  near: number
  far: number
}

/** Breathing room around the part, so it never touches the viewport edges. */
const FIT_MARGIN = 1.18

export function fitCameraToRadius(modelRadius: number, fovDegrees: number, aspect: number): CameraFit {
  const radius = Math.max(Number.isFinite(modelRadius) ? modelRadius : 0, 0.001)
  const vertical = Math.max(fovDegrees, 1) * (Math.PI / 180)
  // A wide viewport is limited by its height and a tall one by its width, so
  // fit against whichever half-angle is smaller.
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * safeAspect)
  const halfAngle = Math.min(vertical, horizontal) / 2

  const distance = (radius * FIT_MARGIN) / Math.sin(halfAngle)
  return {
    distance,
    // Keep the whole part between the clip planes with room to orbit. Tying
    // both to the part's size is what stops a large model being sliced by the
    // far plane and a small one vanishing into the near one.
    near: Math.max(distance - radius * 4, radius * 0.001, 0.001),
    far: distance + radius * 8,
  }
}
