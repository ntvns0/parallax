import { describe, expect, it } from 'vitest'
import { createExtrudeFeature, createFeature, createFilletFeature, type Feature } from '../core/model'
import { buildDrawingSheet, hasDrawableGeometry } from './build-sheet'
import type { DrawingOptions, ProjectedView, SheetPrimitive } from './drawing-types'
import { renderSheetToPdf } from './pdf-renderer'
import { formatScale } from './sheet-format'
import { renderSheetToSvg } from './svg-renderer'

const FIXED_DATE = new Date('2026-08-02T09:30:00Z')

/** A 60 × 40 × 12 plate with a Ø8 hole, as the four standard views. */
function plateViews(): ProjectedView[] {
  const rectangle = (width: number, height: number): ProjectedView['visible'] => [
    { type: 'segment', start: [0, 0], end: [width, 0] },
    { type: 'segment', start: [width, 0], end: [width, height] },
    { type: 'segment', start: [width, height], end: [0, height] },
    { type: 'segment', start: [0, height], end: [0, 0] },
  ]
  return [
    { id: 'front', visible: rectangle(60, 12), hidden: [{ type: 'segment', start: [26, 0], end: [26, 12] }], bounds: { min: [0, 0], max: [60, 12] } },
    {
      id: 'top',
      visible: [...rectangle(60, 40), { type: 'circle', center: [30, 20], radius: 4 }],
      hidden: [],
      bounds: { min: [0, 0], max: [60, 40] },
    },
    { id: 'right', visible: rectangle(40, 12), hidden: [], bounds: { min: [0, 0], max: [40, 12] } },
    { id: 'iso', visible: rectangle(70, 50), hidden: [], bounds: { min: [0, 0], max: [70, 50] } },
  ]
}

function plateFeatures(): Feature[] {
  const sketch = createFeature('sketch', 1)
  const extrude = createExtrudeFeature(sketch.id, 1, 12)
  const fillet = createFilletFeature([{ point: [0, 0, 0], start: [0, 0, 0], end: [1, 0, 0] }], 1, 3)
  return [sketch, extrude, fillet]
}

const OPTIONS: DrawingOptions = {
  sheetSizeId: 'a3',
  views: ['front', 'top', 'right', 'iso'],
  showHiddenLines: true,
  showDimensions: true,
  showCenterMarks: true,
  showParameterTable: true,
  section: { enabled: false, parent: 'front', position: 0.5 },
  scale: null,
  title: { partName: 'Mounting plate', drawnBy: 'N. Evans', material: '6061-T6', finish: 'Anodised', notes: ['Deburr all edges.'] },
}

function build(overrides: Partial<DrawingOptions> = {}) {
  return buildDrawingSheet({
    views: plateViews(),
    features: plateFeatures(),
    displayUnits: 'mm',
    options: { ...OPTIONS, ...overrides },
    date: FIXED_DATE,
  })
}

const texts = (primitives: SheetPrimitive[]) =>
  primitives.filter((primitive): primitive is Extract<SheetPrimitive, { kind: 'text' }> => primitive.kind === 'text')
    .map((primitive) => primitive.text)

const roles = (primitives: SheetPrimitive[]) => new Set(primitives.map((primitive) => primitive.role))

describe('buildDrawingSheet', () => {
  it('produces a sheet of the requested paper size', () => {
    const { sheet } = build({ sheetSizeId: 'letter' })
    expect([sheet.width, sheet.height]).toEqual([279.4, 215.9])
  })

  it('labels every requested view', () => {
    const printed = texts(build().sheet.primitives)
    for (const label of ['FRONT', 'TOP', 'RIGHT', 'ISOMETRIC']) expect(printed).toContain(label)
  })

  it('fills the title block from the supplied information', () => {
    const printed = texts(build().sheet.primitives)
    expect(printed).toContain('Mounting plate')
    expect(printed).toContain('6061-T6')
    expect(printed).toContain('Anodised')
    expect(printed).toContain('N. Evans')
  })

  it('states the unit once, in the title block, rather than after every dimension', () => {
    const printed = texts(build().sheet.primitives)
    expect(printed).toContain('MM')
    expect(printed.some((text) => text.includes('All dimensions in millimetres'))).toBe(true)
    expect(printed.filter((text) => text.endsWith(' mm'))).toEqual([])
  })

  it('dimensions the overall size of the part', () => {
    const printed = texts(build().sheet.primitives)
    expect(printed).toContain('60')
    expect(printed).toContain('40')
    expect(printed).toContain('12')
    expect(printed).toContain('Ø8')
  })

  it('carries the fillet radius into the notes, where a shop looks for it', () => {
    expect(texts(build().sheet.primitives).some((text) => text.includes('R3'))).toBe(true)
  })

  it('keeps the caller notes', () => {
    expect(texts(build().sheet.primitives).some((text) => text.includes('Deburr all edges.'))).toBe(true)
  })

  it('lists the driving model parameters', () => {
    expect(texts(build().sheet.primitives)).toContain('MODEL PARAMETERS')
  })

  it('drops hidden lines when they are turned off', () => {
    expect(roles(build().sheet.primitives)).toContain('hidden')
    expect(roles(build({ showHiddenLines: false }).sheet.primitives)).not.toContain('hidden')
  })

  it('drops centre marks when they are turned off', () => {
    // The projection symbol keeps its own centre line, so count the marks the
    // one hole contributes rather than the role as a whole.
    const centred = (primitives: SheetPrimitive[]) => primitives.filter((primitive) => primitive.role === 'center').length
    expect(centred(build().sheet.primitives) - centred(build({ showCenterMarks: false }).sheet.primitives)).toBe(2)
  })

  it('draws only the requested views', () => {
    const printed = texts(build({ views: ['front', 'top'] }).sheet.primitives)
    expect(printed).toContain('FRONT')
    expect(printed).not.toContain('ISOMETRIC')
  })

  it('reports views that projected nothing instead of silently omitting them', () => {
    const built = buildDrawingSheet({
      views: [...plateViews().filter((view) => view.id !== 'iso'), { id: 'iso', visible: [], hidden: [], bounds: null }],
      features: plateFeatures(),
      displayUnits: 'mm',
      options: { ...OPTIONS, views: ['iso'] },
      date: FIXED_DATE,
    })
    expect(built.emptyViews).toContain('ISOMETRIC')
  })

  it('keeps everything inside the paper', () => {
    const { sheet } = build()
    for (const primitive of sheet.primitives) {
      const points = primitive.kind === 'text' ? [primitive.at]
        : primitive.kind === 'circle' || primitive.kind === 'arc' ? [primitive.center]
        : primitive.points
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(sheet.width)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(sheet.height)
      }
    }
  })

  it('formats dimensions in the document display units', () => {
    const imperial = buildDrawingSheet({
      views: plateViews(),
      features: plateFeatures(),
      displayUnits: 'in-decimal',
      options: OPTIONS,
      date: FIXED_DATE,
    })
    const printed = texts(imperial.sheet.primitives)
    expect(printed).toContain('IN .001')
    expect(printed).toContain('2.362') // 60 mm
  })
})

describe('hasDrawableGeometry', () => {
  it('is false when nothing projected', () => {
    expect(hasDrawableGeometry([{ id: 'front', visible: [], hidden: [], bounds: null }])).toBe(false)
  })

  it('is true once a view has extent', () => {
    expect(hasDrawableGeometry(plateViews())).toBe(true)
  })
})

describe('renderers', () => {
  it('renders SVG that declares the sheet size in millimetres', () => {
    const svg = renderSheetToSvg(build({ sheetSizeId: 'a4' }).sheet)
    expect(svg).toContain('width="297mm"')
    expect(svg).toContain('height="210mm"')
    expect(svg).toContain('viewBox="0 0 297 210"')
  })

  it('flips the Y axis for SVG without mirroring the drawing', () => {
    const { sheet } = build()
    const svg = renderSheetToSvg(sheet)
    // The sheet border starts at the bottom-left corner in sheet space, which
    // is the top of the SVG's inverted Y axis.
    expect(svg).toContain(`M 10 ${sheet.height - 10}`)
  })

  it('escapes text bound for XML', () => {
    const svg = renderSheetToSvg(build({ title: { ...OPTIONS.title, partName: 'Bracket <A&B>' } }).sheet)
    expect(svg).toContain('Bracket &lt;A&amp;B&gt;')
    expect(svg).not.toContain('Bracket <A&B>')
  })

  it('renders a PDF that a viewer can open', () => {
    const pdf = renderSheetToPdf(build().sheet, FIXED_DATE)
    const text = Array.from(pdf, (byte) => String.fromCharCode(byte)).join('')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Type /Page')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('draws circles as Béziers, since PDF has no arc operator', () => {
    const pdf = renderSheetToPdf(build().sheet, FIXED_DATE)
    expect(Array.from(pdf, (byte) => String.fromCharCode(byte)).join('')).toMatch(/ c\n/)
  })

  it('puts the drawing title in the PDF metadata', () => {
    const pdf = renderSheetToPdf(build().sheet, FIXED_DATE)
    expect(Array.from(pdf, (byte) => String.fromCharCode(byte)).join('')).toContain('/Title (Mounting plate')
  })
})

/** The same plate, with a front section cut through the middle of it. */
function sectionView(): ProjectedView {
  return {
    id: 'section',
    visible: [
      { type: 'segment', start: [0, 0], end: [60, 0] },
      { type: 'segment', start: [60, 0], end: [60, 12] },
      { type: 'segment', start: [60, 12], end: [0, 12] },
      { type: 'segment', start: [0, 12], end: [0, 0] },
    ],
    hidden: [],
    bounds: { min: [0, 0], max: [60, 12] },
    section: {
      parent: 'front',
      label: 'A',
      position: 20,
      regions: [{ outer: [[0, 0], [60, 0], [60, 12], [0, 12]], holes: [[[26, 0], [34, 0], [34, 12], [26, 12]]] }],
    },
  }
}

function buildSectioned(overrides: Partial<DrawingOptions> = {}) {
  return buildDrawingSheet({
    views: [...plateViews(), sectionView()],
    features: plateFeatures(),
    displayUnits: 'mm',
    options: { ...OPTIONS, section: { enabled: true, parent: 'front', position: 0.5 }, ...overrides },
    date: FIXED_DATE,
  })
}

describe('section views', () => {
  it('captions the cut with its letters', () => {
    expect(texts(buildSectioned().sheet.primitives)).toContain('SECTION A-A')
  })

  it('draws the section in place of the view it was cut in the direction of', () => {
    const printed = texts(buildSectioned().sheet.primitives)
    expect(printed).toContain('SECTION A-A')
    expect(printed).not.toContain('FRONT')
    // The views it is not replacing are untouched.
    expect(printed).toContain('TOP')
    expect(printed).toContain('RIGHT')
  })

  it('hatches the material the cut met', () => {
    expect(roles(buildSectioned().sheet.primitives)).toContain('hatch')
    expect(roles(build().sheet.primitives)).not.toContain('hatch')
  })

  it('marks where the cut was taken, on the view that shows the plane edge-on', () => {
    expect(roles(buildSectioned().sheet.primitives)).toContain('cuttingPlane')
    const labels = texts(buildSectioned().sheet.primitives).filter((text) => text === 'A')
    expect(labels).toHaveLength(2)
  })

  it('leaves the cutting-plane line off when its reference view is not on the sheet', () => {
    // A front section is marked on the top view; without it there is nothing to
    // mark, and the letters would float on empty paper.
    const withoutHost = buildSectioned({ views: ['front', 'right'] })
    expect(roles(withoutHost.sheet.primitives)).not.toContain('cuttingPlane')
    expect(texts(withoutHost.sheet.primitives)).toContain('SECTION A-A')
  })

  it('ignores the projected section when sections are switched off', () => {
    const off = buildSectioned({ section: { enabled: false, parent: 'front', position: 0.5 } })
    expect(texts(off.sheet.primitives)).toContain('FRONT')
    expect(texts(off.sheet.primitives)).not.toContain('SECTION A-A')
  })

  it('keeps the hatching inside the paper', () => {
    const { sheet } = buildSectioned()
    for (const primitive of sheet.primitives) {
      if (primitive.role !== 'hatch' || primitive.kind !== 'path') continue
      for (const [x, y] of primitive.points) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(sheet.width)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(sheet.height)
      }
    }
  })
})

describe('pictorial scale', () => {
  it('captions the isometric with its own scale, not the sheet scale', () => {
    // It is drawn smaller than the dimensioned views, so repeating the sheet
    // scale under it would invite someone to measure the wrong view.
    const printed = texts(build().sheet.primitives)
    const sheetScale = formatScale(build().scale)
    expect(printed).toContain(sheetScale)
    expect(printed.some((text) => /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(text) && text !== sheetScale)).toBe(true)
  })
})
