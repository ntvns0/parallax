import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import { draw, drawCircle, measureVolume, setOC, type Drawing, type Shape3D } from 'replicad'
import { normalizeArc, arcMidPoint } from '../core/arc-geometry'
import { arcAlong, getClosedProfiles, getProfileRegions, type ClosedProfile, type ProfileRegion } from '../core/sketch'
import { createFeature, createId, type SketchEntity, type SketchFeature, type Vec2 } from '../core/model'

/**
 * The exact-geometry end of the arc pipeline.
 *
 * Unit tests can show that a profile closes; only OpenCascade can show that the
 * solid it closes into is the right one. Each case here is checked against an
 * area worked out by hand, so a mis-signed sweep or an arc drawn the long way
 * round shows up as a wrong number rather than as a plausible-looking shape.
 *
 * This is the one test that loads the kernel, so it carries a longer timeout.
 */

// Resolved from the working directory rather than import.meta.url: the test
// environment is jsdom, where that is not a file URL.
const WASM = resolve(process.cwd(), 'node_modules/replicad-opencascadejs/src/replicad_single.wasm')
const HALF_PI = Math.PI / 2

function line(start: Vec2, end: Vec2): SketchEntity {
  return { id: createId(), type: 'line', start, end, construction: false }
}

function arc(center: Vec2, radius: number, from: number, to: number): SketchEntity {
  const normalized = normalizeArc(center, radius, from, to)
  return {
    id: createId(),
    type: 'arc',
    center: normalized.center,
    radius: normalized.radius,
    startAngle: normalized.startAngle,
    endAngle: normalized.endAngle,
    construction: false,
  }
}

function sketchOf(entities: SketchEntity[]): SketchFeature {
  const sketch = createFeature('sketch', 1) as SketchFeature
  sketch.entities = entities
  return sketch
}

/**
 * A slot: two straight sides closed by a half-round at each end, each bulging
 * away from the body.
 */
function slotEntities(): SketchEntity[] {
  return [
    line([0, 5], [20, 5]),
    arc([20, 0], 5, -HALF_PI, HALF_PI),
    line([20, -5], [0, -5]),
    arc([0, 0], 5, HALF_PI, -HALF_PI),
  ]
}

/** Kept in step with drawingFromProfile in exact-kernel.worker.ts. */
function drawingFromProfile(profile: ClosedProfile): Drawing {
  if (profile.type === 'circle') return drawCircle(profile.radius).translate(profile.center)
  if (profile.type === 'polygon') {
    const [first, ...rest] = profile.points
    const pen = draw(first)
    rest.forEach((point) => pen.lineTo(point))
    return pen.close()
  }
  const pen = draw(profile.segments[0].start)
  for (const segment of profile.segments) {
    if (segment.kind === 'line') pen.lineTo(segment.end)
    else pen.threePointsArcTo(segment.end, arcMidPoint(arcAlong(segment)))
  }
  return pen.close()
}

function drawingFromRegion(region: ProfileRegion): Drawing {
  let drawing = drawingFromProfile(region.outer)
  for (const hole of region.holes) drawing = drawing.cut(drawingFromProfile(hole))
  return drawing
}

/** The cross-sectional area of the solid a sketch extrudes into. */
function crossSectionArea(entities: SketchEntity[], depth: number): number {
  const [region] = getProfileRegions(sketchOf(entities))
  const solid = drawingFromRegion(region).sketchOnPlane('XY', 0).extrude(depth) as Shape3D
  const area = measureVolume(solid) / depth
  solid.delete()
  return area
}

/** A 20 x 10 body capped by two half-rounds, which together make one circle. */
const SLOT_AREA = 20 * 10 + Math.PI * 25

beforeAll(async () => {
  const init = initOpenCascade as unknown as (
    config: { locateFile: () => string; wasmBinary: Buffer },
  ) => Promise<Parameters<typeof setOC>[0]>
  setOC(await init({ locateFile: () => WASM, wasmBinary: readFileSync(WASM) }))
}, 120_000)

describe('exact solids from profiles containing arcs', () => {
  it('extrudes a slot to its true cross-section', () => {
    expect(crossSectionArea(slotEntities(), 10)).toBeCloseTo(SLOT_AREA, 6)
  })

  it('punches a slot-shaped hole through a plate', () => {
    const plate = [
      line([-20, -20], [40, -20]),
      line([40, -20], [40, 20]),
      line([40, 20], [-20, 20]),
      line([-20, 20], [-20, -20]),
      ...slotEntities(),
    ]
    const [region] = getProfileRegions(sketchOf(plate))
    expect(region.holes).toHaveLength(1)
    expect(crossSectionArea(plate, 8)).toBeCloseTo(60 * 40 - SLOT_AREA, 6)
  })

  it('builds a D shape from one line and one arc', () => {
    // A half-disc: the arc bulges left of the straight edge on the Y axis.
    const entities = [line([0, -5], [0, 5]), arc([0, 0], 5, HALF_PI, -HALF_PI)]
    expect(crossSectionArea(entities, 4)).toBeCloseTo((Math.PI * 25) / 2, 6)
  })

  it('sweeps an arc the short way round, not the long way', () => {
    // A quarter-round fillet corner: a 90° arc closed by two straight legs. Were
    // the sweep taken the other way it would enclose the other 270°.
    const entities = [
      line([0, 0], [10, 0]),
      arc([0, 0], 10, 0, HALF_PI),
      line([0, 10], [0, 0]),
    ]
    expect(crossSectionArea(entities, 3)).toBeCloseTo((Math.PI * 100) / 4, 6)
  })

  it('keeps an all-straight profile on the polygon path', () => {
    const square = [
      line([0, 0], [10, 0]),
      line([10, 0], [10, 10]),
      line([10, 10], [0, 10]),
      line([0, 10], [0, 0]),
    ]
    expect(getClosedProfiles(sketchOf(square))[0].type).toBe('polygon')
    expect(crossSectionArea(square, 5)).toBeCloseTo(100, 6)
  })
})
