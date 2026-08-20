import { describe, expect, it } from 'vitest'
import { autoDimensionView, centerMarkCurves } from './auto-dimension'
import type { DrawingDimension, DrawingViewId, Point2, ProjectedCurve, ProjectedView } from './drawing-types'

const format = (millimetres: number) => String(Math.round(millimetres * 100) / 100)

function view(id: DrawingViewId, visible: ProjectedCurve[], bounds: ProjectedView['bounds']): ProjectedView {
  return { id, visible, hidden: [], bounds }
}

/** A 60 × 40 plate with four Ø6 holes inset 10 mm from each corner. */
function fourHolePlate(): ProjectedView {
  const holes: ProjectedCurve[] = [
    { type: 'circle', center: [10, 10], radius: 3 },
    { type: 'circle', center: [50, 10], radius: 3 },
    { type: 'circle', center: [10, 30], radius: 3 },
    { type: 'circle', center: [50, 30], radius: 3 },
  ]
  return view('top', [{ type: 'segment', start: [0, 0], end: [60, 0] }, ...holes], { min: [0, 0], max: [60, 40] })
}

const linear = (dimensions: DrawingDimension[]) =>
  dimensions.filter((entry): entry is Extract<DrawingDimension, { kind: 'linear' }> => entry.kind === 'linear')
const diameters = (dimensions: DrawingDimension[]) =>
  dimensions.filter((entry): entry is Extract<DrawingDimension, { kind: 'diameter' }> => entry.kind === 'diameter')

describe('autoDimensionView', () => {
  it('dimensions the overall width and height first', () => {
    const dimensions = linear(autoDimensionView(fourHolePlate(), { formatValue: format }))
    expect(dimensions[0]).toMatchObject({ axis: 'horizontal', text: '60' })
    expect(dimensions[1]).toMatchObject({ axis: 'vertical', text: '40' })
  })

  it('calls out one diameter per distinct hole size, with a count', () => {
    const callouts = diameters(autoDimensionView(fourHolePlate(), { formatValue: format }))
    expect(callouts).toHaveLength(1)
    expect(callouts[0].text).toBe('4× Ø6')
  })

  it('writes a lone hole without a count', () => {
    const single = view('top', [{ type: 'circle', center: [5, 5], radius: 2 }], { min: [0, 0], max: [20, 20] })
    expect(diameters(autoDimensionView(single, { formatValue: format }))[0].text).toBe('Ø4')
  })

  it('positions a hole pattern with one dimension per centre line, not one per hole', () => {
    const dimensions = linear(autoDimensionView(fourHolePlate(), { formatValue: format }))
    // Two overall dimensions, then two X centre lines and two Y centre lines.
    expect(dimensions).toHaveLength(6)
    expect(dimensions.slice(2).map((entry) => entry.text)).toEqual(['10', '50', '10', '30'])
  })

  it('measures every hole from the same datum corner so tolerances cannot chain', () => {
    const dimensions = linear(autoDimensionView(fourHolePlate(), { formatValue: format }))
    for (const dimension of dimensions) {
      expect(dimension.from).toEqual([0, 0])
    }
  })

  it('stacks each further dimension further out so they do not overlap', () => {
    const offsets = linear(autoDimensionView(fourHolePlate(), { formatValue: format }))
      .filter((entry) => entry.axis === 'horizontal')
      .map((entry) => entry.offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    expect(new Set(offsets).size).toBe(offsets.length)
  })

  it('describes a round part by its diameter instead of boxing it', () => {
    const disc = view('top', [{ type: 'circle', center: [0, 0], radius: 12 }], { min: [-12, -12], max: [12, 12] })
    const dimensions = autoDimensionView(disc, { formatValue: format })
    expect(linear(dimensions)).toHaveLength(0)
    expect(diameters(dimensions)[0].text).toBe('Ø24')
  })

  it('leaves the pictorial view unannotated', () => {
    const iso = view('iso', [{ type: 'circle', center: [0, 0], radius: 5 }], { min: [-5, -5], max: [5, 5] })
    expect(autoDimensionView(iso, { formatValue: format })).toEqual([])
  })

  it('stops stacking position dimensions once the sheet would be unreadable', () => {
    const many: ProjectedCurve[] = Array.from({ length: 9 }, (_, index) => ({
      type: 'circle',
      center: [5 + index * 5, 10],
      radius: 1,
    }))
    const dimensions = linear(autoDimensionView(
      view('top', many, { min: [0, 0], max: [60, 20] }),
      { formatValue: format, maxPositionDimensions: 3 },
    ))
    expect(dimensions.filter((entry) => entry.axis === 'horizontal')).toHaveLength(1 + 3)
  })

  it('produces nothing for a view with no geometry', () => {
    expect(autoDimensionView(view('front', [], null), { formatValue: format })).toEqual([])
  })
})

describe('centerMarkCurves', () => {
  it('crosses each circle centre with arms that run past the circle', () => {
    const marks = centerMarkCurves(view('top', [{ type: 'circle', center: [4, 6], radius: 2 }], { min: [0, 0], max: [10, 10] }))
    expect(marks).toHaveLength(2)
    expect(marks[0]).toEqual({ type: 'segment', start: [1.5, 6], end: [6.5, 6] })
    expect(marks[1]).toEqual({ type: 'segment', start: [4, 3.5], end: [4, 8.5] })
  })
})

describe('radius callouts', () => {
  const corner = (center: Point2, radius: number, startAngle: number): ProjectedCurve =>
    ({ type: 'arc', center, radius, startAngle, endAngle: startAngle + Math.PI / 2 })

  it('states a fillet as a radius, never as a diameter', () => {
    const filleted = view('front', [corner([5, 5], 3, Math.PI)], { min: [0, 0], max: [40, 20] })
    const callouts = autoDimensionView(filleted, { formatValue: format })
      .filter((entry) => entry.kind === 'radius')
    expect(callouts).toHaveLength(1)
    expect(callouts[0].text).toBe('R3')
    expect(autoDimensionView(filleted, { formatValue: format }).some((entry) => entry.kind === 'diameter')).toBe(false)
  })

  it('counts equal fillets into one callout', () => {
    const corners = [
      corner([5, 5], 3, Math.PI),
      corner([35, 5], 3, -Math.PI / 2),
      corner([5, 15], 3, Math.PI / 2),
      corner([35, 15], 3, 0),
    ]
    const callouts = autoDimensionView(view('front', corners, { min: [0, 0], max: [40, 20] }), { formatValue: format })
      .filter((entry) => entry.kind === 'radius')
    expect(callouts).toHaveLength(1)
    expect(callouts[0].text).toBe('4× R3')
  })

  it('calls out only the largest radii, leaving the rest to the sheet notes', () => {
    const arcs = [1, 2, 3, 4].map((radius, index) => corner([5 + index * 8, 5], radius, Math.PI))
    const callouts = autoDimensionView(view('front', arcs, { min: [0, 0], max: [40, 20] }), { formatValue: format })
      .filter((entry) => entry.kind === 'radius')
    expect(callouts).toHaveLength(2)
    expect(callouts.map((entry) => entry.text)).toEqual(['R4', 'R3'])
  })

  it('ignores arcs that are only visible through material', () => {
    const hiddenOnly: ProjectedView = {
      id: 'front',
      visible: [{ type: 'segment', start: [0, 0], end: [40, 0] }],
      hidden: [corner([5, 5], 3, Math.PI)],
      bounds: { min: [0, 0], max: [40, 20] },
    }
    expect(autoDimensionView(hiddenOnly, { formatValue: format }).some((entry) => entry.kind === 'radius')).toBe(false)
  })

  it('spreads callouts so their leaders do not land on top of each other', () => {
    const circles: ProjectedCurve[] = [
      { type: 'circle', center: [20, 20], radius: 3 },
      { type: 'circle', center: [20, 20], radius: 6 },
      { type: 'circle', center: [20, 20], radius: 9 },
    ]
    const callouts = autoDimensionView(view('top', circles, { min: [0, 0], max: [40, 40] }), { formatValue: format })
      .filter((entry) => entry.kind === 'diameter')
    expect(new Set(callouts.map((entry) => entry.angle)).size).toBe(callouts.length)
  })
})

describe('step dimensions', () => {
  /** A stepped block: 60 wide, with a shoulder rising at x = 25. */
  const stepped = (): ProjectedView => view('front', [
    { type: 'segment', start: [0, 0], end: [60, 0] },
    { type: 'segment', start: [25, 0], end: [25, 20] },
    { type: 'segment', start: [0, 0], end: [0, 20] },
    { type: 'segment', start: [60, 0], end: [60, 20] },
  ], { min: [0, 0], max: [60, 20] })

  it('positions a shoulder from the datum', () => {
    const texts = autoDimensionView(stepped(), { formatValue: format })
      .filter((entry) => entry.kind === 'linear' && entry.axis === 'horizontal')
      .map((entry) => entry.text)
    expect(texts).toContain('25')
  })

  it('does not dimension a fillet tangent line as if it were a feature', () => {
    // The straight edge a 2 mm fillet leaves just inside a 60 mm outline is a
    // real edge, but calling it out repeats what the radius already says.
    const tangent = view('front', [
      ...stepped().visible,
      { type: 'segment', start: [2, 0], end: [2, 20] },
    ], { min: [0, 0], max: [60, 20] })
    const texts = autoDimensionView(tangent, { formatValue: format })
      .filter((entry) => entry.kind === 'linear')
      .map((entry) => entry.text)
    expect(texts).not.toContain('2')
  })

  it('ignores short edges that are not structural', () => {
    const nicked = view('front', [
      ...stepped().visible,
      { type: 'segment', start: [40, 0], end: [40, 1] },
    ], { min: [0, 0], max: [60, 20] })
    const texts = autoDimensionView(nicked, { formatValue: format })
      .filter((entry) => entry.kind === 'linear')
      .map((entry) => entry.text)
    expect(texts).not.toContain('40')
  })
})
