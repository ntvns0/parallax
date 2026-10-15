import { describe, expect, it } from 'vitest'
import { drivenSketches, sketchesAwaitingSolve } from './driven-sketches'
import { createEmptyDocument, type CadDocument, type SketchFeature } from './model'

function sketch(id: string, width: number, formula?: string): SketchFeature {
  return {
    id, kind: 'sketch', name: id, plane: 'XY', parameters: { planeOffset: 0 },
    position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    entities: [{ id: `${id}-bottom`, type: 'line', start: [0, 0], end: [width, 0], construction: false }],
    constraints: [{ id: `${id}-width`, type: 'distance', entityIds: [`${id}-bottom`], value: width, ...(formula ? { formula } : {}) }],
  }
}

function documentWith(...sketches: SketchFeature[]): CadDocument {
  return { ...createEmptyDocument(), id: 'doc', features: sketches }
}

function retarget(document: CadDocument, sketchId: string, value: number): CadDocument {
  return {
    ...document,
    features: document.features.map((feature) => feature.id === sketchId && feature.kind === 'sketch'
      ? { ...feature, constraints: feature.constraints.map((constraint) => ({ ...constraint, value })) }
      : feature),
  }
}

describe('sketchesAwaitingSolve', () => {
  it('names a driven sketch whose dimension changed and geometry did not', () => {
    // The parameter table moved the number; nothing has moved the line yet.
    const before = documentWith(sketch('s1', 40, 'width'))
    expect(sketchesAwaitingSolve(before, retarget(before, 's1', 60))).toEqual(['s1'])
  })

  it('ignores a sketch whose geometry moved with its dimension', () => {
    // The sketcher solved it already, or an undo restored a solved snapshot.
    const before = documentWith(sketch('s1', 40, 'width'))
    expect(sketchesAwaitingSolve(before, documentWith(sketch('s1', 60, 'width')))).toEqual([])
  })

  it('ignores dimensions typed as plain numbers', () => {
    // Those are edited through the sketcher, which solves as it commits.
    const before = documentWith(sketch('s1', 40))
    expect(sketchesAwaitingSolve(before, retarget(before, 's1', 60))).toEqual([])
  })

  it('ignores edits that leave driven values alone', () => {
    const before = documentWith(sketch('s1', 40, 'width'), sketch('s2', 10))
    expect(sketchesAwaitingSolve(before, retarget(before, 's2', 12))).toEqual([])
  })

  it('solves every driven sketch when a different document opens', () => {
    const opened = { ...documentWith(sketch('s1', 40, 'width'), sketch('s2', 10)), id: 'other' }
    expect(sketchesAwaitingSolve(documentWith(), opened)).toEqual(['s1'])
  })
})

describe('drivenSketches', () => {
  it('lists the sketches with at least one formula-driven dimension', () => {
    expect(drivenSketches(documentWith(sketch('s1', 40, 'width'), sketch('s2', 10)))).toEqual(['s1'])
  })
})
