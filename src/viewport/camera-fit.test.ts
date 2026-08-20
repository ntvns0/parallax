import { describe, expect, it } from 'vitest'
import { fitCameraToRadius } from './camera-fit'

/** Half-height of the view frustum at a given distance. */
const visibleHalfHeight = (distance: number, fov: number) => Math.tan((fov * Math.PI) / 180 / 2) * distance
const FOV = 38

describe('fitCameraToRadius', () => {
  it('leaves the part inside the frustum with a margin', () => {
    const fit = fitCameraToRadius(100, FOV, 16 / 9)

    // Wide viewport, so height is the tighter constraint.
    expect(visibleHalfHeight(fit.distance, FOV)).toBeGreaterThan(100)
  })

  it('pulls back further on a tall narrow viewport, where width constrains', () => {
    const wide = fitCameraToRadius(100, FOV, 16 / 9)
    const tall = fitCameraToRadius(100, FOV, 0.5)

    expect(tall.distance).toBeGreaterThan(wide.distance)
  })

  it('is the same distance whatever direction the part is viewed from', () => {
    // The fit is derived from the bounding sphere, which has no orientation —
    // this is what makes one implementation serve every preset view and every
    // orbited angle alike.
    expect(fitCameraToRadius(100, FOV, 1.6)).toEqual(fitCameraToRadius(100, FOV, 1.6))
  })

  it('scales linearly with the part', () => {
    const small = fitCameraToRadius(10, FOV, 1.6)
    const large = fitCameraToRadius(1000, FOV, 1.6)

    expect(large.distance / small.distance).toBeCloseTo(100)
  })

  it('keeps a large part between the clip planes', () => {
    const radius = 2000
    const fit = fitCameraToRadius(radius, FOV, 1.6)

    expect(fit.near).toBeLessThan(fit.distance - radius)
    expect(fit.far).toBeGreaterThan(fit.distance + radius)
    expect(fit.near).toBeGreaterThan(0)
  })

  it('keeps a tiny part visible without collapsing the near plane', () => {
    const fit = fitCameraToRadius(0.05, FOV, 1.6)

    expect(fit.near).toBeGreaterThan(0)
    expect(fit.near).toBeLessThan(fit.far)
    expect(fit.distance).toBeGreaterThan(0)
  })

  it('survives a degenerate model or viewport rather than producing NaN', () => {
    for (const fit of [
      fitCameraToRadius(0, FOV, 1.6),
      fitCameraToRadius(Number.NaN, FOV, 1.6),
      fitCameraToRadius(100, FOV, 0),
      fitCameraToRadius(100, FOV, Number.NaN),
    ]) {
      expect(Number.isFinite(fit.distance)).toBe(true)
      expect(fit.distance).toBeGreaterThan(0)
      expect(fit.near).toBeLessThan(fit.far)
    }
  })
})
