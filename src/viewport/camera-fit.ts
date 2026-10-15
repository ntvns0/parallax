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

/**
 * How far a perspective camera has to sit from a plane, looking straight at it,
 * for the plane to appear at `pixelsPerMm`.
 *
 * Perspective is exact for every point on the plane it is aimed at, which is
 * what lets the 2D sketcher draw over the live scene: anything on the sketch
 * plane lines up to the pixel, and only geometry off the plane is
 * foreshortened.
 */
export function planeViewDistance(hostHeightPx: number, fovDegrees: number, pixelsPerMm: number): number {
  const visibleHeightMm = Math.max(hostHeightPx, 1) / pixelsPerMm
  return visibleHeightMm / (2 * Math.tan((fovDegrees * Math.PI) / 180 / 2))
}

/**
 * The orthographic frustum, in millimetres either side of the view centre,
 * that shows a `width` × `height` pixel viewport at `pixelsPerMm`.
 *
 * Orthographic rather than perspective because a sketch is drawn over the
 * part: what shows through has to be the part projected straight onto the
 * sketch plane, so a face 25 mm above the plane appears at its true size.
 */
export function planeViewFrustum(width: number, height: number, pixelsPerMm: number) {
  const halfWidth = Math.max(width, 1) / 2 / pixelsPerMm
  const halfHeight = Math.max(height, 1) / 2 / pixelsPerMm
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
}

/**
 * The orthographic frustum that matches a perspective camera at the plane
 * through its orbit target, `distance` away.
 *
 * Orbiting, panning and zooming all keep driving the perspective camera; an
 * orthographic view copies its pose and takes this frustum, so switching
 * projection leaves the part under the cursor where it was and the wheel
 * still zooms.
 */
export function orthographicMatch(distance: number, fovDegrees: number, aspect: number) {
  const halfHeight = Math.max(distance, 1e-6) * Math.tan((fovDegrees * Math.PI) / 180 / 2)
  const halfWidth = halfHeight * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1)
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
}

/**
 * How many millimetres one screen pixel spans at `distance` from a camera:
 * from the perspective field of view, or for an orthographic camera from its
 * frustum alone.
 */
export function millimetresPerPixel(
  camera: { isOrthographicCamera?: boolean; top?: number; bottom?: number; zoom?: number; fov?: number },
  distance: number,
  hostHeightPx: number,
) {
  const height = Math.max(1, hostHeightPx)
  if (camera.isOrthographicCamera) return ((camera.top ?? 1) - (camera.bottom ?? -1)) / (camera.zoom ?? 1) / height
  return (2 * Math.tan(((camera.fov ?? 50) * Math.PI) / 180 / 2) * distance) / height
}
