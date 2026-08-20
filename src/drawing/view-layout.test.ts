import { describe, expect, it } from 'vitest'
import type { Bounds2, DrawingViewId, ProjectedView } from './drawing-types'
import { STANDARD_SCALES } from './sheet-format'
import { chooseScale, layoutViews, plainPadding, scaleForView, transformPoint, type PaddingLookup } from './view-layout'

/** Stand-in for the space a dimensioned view asks for. */
const ANNOTATED: PaddingLookup = () => plainPadding({ left: 30, bottom: 34, right: 24, top: 8 })
const PLAIN: PaddingLookup = () => plainPadding()

/**
 * A block 30 wide (X), 20 deep (Y) and 10 tall (Z), projected into the standard
 * views. The numbers are what each view of that block actually measures, which
 * is what makes the alignment assertions below meaningful.
 */
function blockViews(): ProjectedView[] {
  const view = (id: DrawingViewId, width: number, height: number): ProjectedView => ({
    id,
    visible: [{ type: 'segment', start: [0, 0], end: [width, height] }],
    hidden: [],
    bounds: { min: [0, 0], max: [width, height] },
  })
  return [view('front', 30, 10), view('top', 30, 20), view('right', 20, 10), view('iso', 35, 28)]
}

const A3: Bounds2 = { min: [10, 10], max: [410, 287] }

describe('chooseScale', () => {
  it('only ever returns a preferred scale, so a printed sheet stays measurable', () => {
    const scale = chooseScale(blockViews(), A3, ANNOTATED)
    expect(STANDARD_SCALES).toContain(scale)
  })

  it('picks a smaller scale when the paper is smaller', () => {
    const small: Bounds2 = { min: [0, 0], max: [120, 90] }
    expect(chooseScale(blockViews(), small, ANNOTATED)).toBeLessThan(chooseScale(blockViews(), A3, ANNOTATED))
  })

  it('leaves room for annotation, so an annotated sheet is never scaled larger than a plain one', () => {
    const views = blockViews()
    expect(chooseScale(views, A3, ANNOTATED)).toBeLessThanOrEqual(chooseScale(views, A3, PLAIN))
  })
})

describe('layoutViews', () => {
  const layout = layoutViews(blockViews(), A3, { padding: ANNOTATED })
  const placement = (id: DrawingViewId) => layout.placements.find((candidate) => candidate.id === id)!

  it('draws every projected view at one scale, so they can be compared', () => {
    // The isometric is deliberately excluded — it is drawn smaller and says so
    // in its own caption.
    const projected = layout.placements.filter((entry) => entry.id !== 'iso')
    expect(new Set(projected.map((entry) => entry.scale)).size).toBe(1)
  })

  it('places the top view above the front view', () => {
    expect(placement('top').cell.min[1]).toBeGreaterThan(placement('front').cell.max[1] - 1e-9)
  })

  it('places the right view beside the front view', () => {
    expect(placement('right').cell.min[0]).toBeGreaterThan(placement('front').cell.max[0] - 1e-9)
  })

  it('keeps front and top in vertical projection', () => {
    // Both views measure model X horizontally, so a point at model x = 0 must
    // land on the same sheet column in each. This is the alignment a reader
    // uses to carry a feature from one view to the next.
    const front = transformPoint(placement('front'), [0, 0])
    const top = transformPoint(placement('top'), [0, 0])
    expect(front[0]).toBeCloseTo(top[0], 9)
  })

  it('keeps front and right in horizontal projection', () => {
    // Both measure model Z vertically.
    const front = transformPoint(placement('front'), [0, 0])
    const right = transformPoint(placement('right'), [0, 0])
    expect(front[1]).toBeCloseTo(right[1], 9)
  })

  it('honours an explicitly chosen scale', () => {
    const fixed = layoutViews(blockViews(), A3, { padding: ANNOTATED, scale: 2 })
    expect(fixed.scale).toBe(2)
    const front = fixed.placements.find((entry) => entry.id === 'front')!
    const [left, right] = [transformPoint(front, [0, 0])[0], transformPoint(front, [30, 0])[0]]
    expect(right - left).toBeCloseTo(60, 9)
  })

  it('ignores views that projected no geometry', () => {
    const views: ProjectedView[] = [...blockViews(), { id: 'iso', visible: [], hidden: [], bounds: null }]
    expect(layoutViews(views, A3, { padding: ANNOTATED }).placements.some((entry) => entry.bounds === null)).toBe(false)
  })

  it('centres a single view rather than pinning it to a corner', () => {
    const single = layoutViews([blockViews()[0]], A3, { padding: ANNOTATED })
    const front = single.placements[0]
    const cellCentre = (front.cell.min[0] + front.cell.max[0]) / 2
    const areaCentre = (A3.min[0] + A3.max[0]) / 2
    expect(cellCentre).toBeCloseTo(areaCentre, 6)
  })
})

describe('scaleForView', () => {
  it('draws projected views at the sheet scale', () => {
    for (const id of ['front', 'top', 'right', 'section'] as const) {
      expect(scaleForView(id, 1 / 2)).toBe(1 / 2)
    }
  })

  it('draws the isometric smaller, at a preferred scale', () => {
    const isoScale = scaleForView('iso', 1)
    expect(isoScale).toBeLessThan(1)
    expect(STANDARD_SCALES).toContain(isoScale)
  })

  it('never draws the isometric larger than the dimensioned views', () => {
    for (const sheetScale of STANDARD_SCALES) {
      expect(scaleForView('iso', sheetScale)).toBeLessThanOrEqual(sheetScale)
    }
  })
})

describe('section placement', () => {
  it('takes the cell of the view it replaces, staying in projection with the rest', () => {
    const views = blockViews().filter((view) => view.id !== 'front')
    const section: ProjectedView = {
      id: 'section',
      visible: [{ type: 'segment', start: [0, 0], end: [30, 10] }],
      hidden: [],
      bounds: { min: [0, 0], max: [30, 10] },
      section: { parent: 'front', label: 'A', position: 10, regions: [] },
    }
    const layout = layoutViews([...views, section], A3, { padding: ANNOTATED })
    const placed = layout.placements.find((entry) => entry.id === 'section')!
    const top = layout.placements.find((entry) => entry.id === 'top')!

    // The front cell sits below the top cell and shares its column.
    expect(placed.cell.max[1]).toBeLessThanOrEqual(top.cell.min[1] + 1e-9)
    expect(transformPoint(placed, [0, 0])[0]).toBeCloseTo(transformPoint(top, [0, 0])[0], 9)
  })
})
