import { describe, expect, it } from 'vitest'
import type { ExtrudeFeature, Feature, SketchEntity, SketchFeature } from '../core/model'
import { buildOperationChain } from './operation-chain'
import type { KernelExtrudeOperation } from './kernel-types'

function extrusionOperations(features: ReturnType<typeof buildOperationChain>) {
  return features.filter((operation): operation is KernelExtrudeOperation => operation.type === 'extrude')
}

function rectangle(id: string, min: [number, number], max: [number, number]): SketchEntity[] {
  const corners: [number, number][] = [min, [max[0], min[1]], max, [min[0], max[1]]]
  return corners.map((corner, index) => ({
    id: `${id}-line-${index}`,
    type: 'line',
    start: corner,
    end: corners[(index + 1) % 4],
    construction: false,
  }))
}

function sketch(id: string, entities: SketchEntity[], plane: SketchFeature['plane'] = 'XY'): SketchFeature {
  return {
    id,
    kind: 'sketch',
    name: id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
    plane,
    parameters: { planeOffset: 0 },
    entities,
    constraints: [],
  }
}

function extrude(id: string, sketchId: string, operation: ExtrudeFeature['operation'], distance = 10): ExtrudeFeature {
  return {
    id,
    kind: 'extrude',
    name: id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
    sketchId,
    operation,
    parameters: { distance, symmetric: false, edgeRadius: 0 },
  }
}

/** A sketch drawn on a face, whose distances are signed along that face's outward normal. */
function faceSketch(id: string, entities: SketchEntity[], plane: SketchFeature['plane'], planeOffset: number, faceNormalSign: -1 | 1): SketchFeature {
  return { ...sketch(id, entities, plane), parameters: { planeOffset, faceNormalSign } }
}

describe('face-attached extrusion direction', () => {
  const profile = rectangle('pocket', [5, 5], [15, 15])

  it('digs into the part from a top face', () => {
    // Top face: outward is +Z, so a pocket runs down the plane normal.
    const source = faceSketch('top', profile, 'XY', 20, 1)
    const cut = extrude('cut', 'top', 'cut', -6)

    const [operation] = extrusionOperations(buildOperationChain(cut, [source, cut]))

    expect(operation.distance).toBe(-6)
    expect(operation.planeOffset).toBe(20)
  })

  it('digs into the part from a bottom face, where outward runs the other way', () => {
    // Bottom face: outward is -Z, so digging in means going *up* the plane normal.
    const source = faceSketch('bottom', profile, 'XY', 0, -1)
    const cut = extrude('cut', 'bottom', 'cut', -6)

    const [operation] = extrusionOperations(buildOperationChain(cut, [source, cut]))

    expect(operation.distance).toBe(6)
  })

  it('grows away from the part when the distance is positive', () => {
    const source = faceSketch('top', profile, 'XY', 20, 1)
    const boss = extrude('boss', 'top', 'add', 6)

    const [operation] = extrusionOperations(buildOperationChain(boss, [source, boss]))

    expect(operation.distance).toBe(6)
  })

  it('does not let the boolean flip the direction a second time', () => {
    // A cut and an add of the same signed distance must sweep the same volume;
    // only the boolean differs. Flipping in both places was the old bug.
    const source = faceSketch('top', profile, 'XY', 20, 1)
    const asCut = extrude('a', 'top', 'cut', -6)
    const asAdd = extrude('b', 'top', 'add', -6)

    const [cutOperation] = extrusionOperations(buildOperationChain(asCut, [source, asCut]))
    const [addOperation] = extrusionOperations(buildOperationChain(asAdd, [source, asAdd]))

    expect(cutOperation.distance).toBe(addOperation.distance)
  })

  it('leaves a base-plane sketch measured along its own plane normal', () => {
    const source = sketch('base', profile, 'XY')
    const cut = extrude('cut', 'base', 'cut', -6)

    const [operation] = extrusionOperations(buildOperationChain(cut, [source, cut]))

    expect(operation.distance).toBe(-6)
  })
})

describe('kernel operation chain', () => {
  it('replays earlier extrusions so booleans have their operands', () => {
    const base = sketch('base', rectangle('base', [0, 0], [40, 20]))
    const pocket = sketch('pocket', rectangle('pocket', [5, 5], [15, 15]))
    const baseExtrude = extrude('extrude-base', 'base', 'newBody', 12)
    const cut = extrude('extrude-cut', 'pocket', 'cut', -6)
    const features: Feature[] = [base, baseExtrude, pocket, cut]

    const chain = buildOperationChain(cut, features)

    expect(extrusionOperations(chain).map((operation) => operation.operation)).toEqual(['newBody', 'cut'])
    expect(chain.map((operation) => operation.featureId)).toEqual(['extrude-base', 'extrude-cut'])
  })

  it('stops at the requested feature', () => {
    const base = sketch('base', rectangle('base', [0, 0], [40, 20]))
    const later = sketch('later', rectangle('later', [0, 0], [10, 10]))
    const baseExtrude = extrude('extrude-base', 'base', 'newBody')
    const laterExtrude = extrude('extrude-later', 'later', 'add')
    const features: Feature[] = [base, baseExtrude, later, laterExtrude]

    expect(buildOperationChain(baseExtrude, features)).toHaveLength(1)
    expect(buildOperationChain(laterExtrude, features)).toHaveLength(2)
  })

  it('carries an inner circle through as a hole rather than a separate region', () => {
    const plate = sketch('plate', [
      ...rectangle('plate', [0, 0], [40, 40]),
      { id: 'bore', type: 'circle', center: [20, 20], radius: 5, construction: false },
    ])
    const chain = buildOperationChain(extrude('extrude-plate', 'plate', 'newBody'), [plate, extrude('extrude-plate', 'plate', 'newBody')])

    expect(chain).toHaveLength(1)
    const [operation] = extrusionOperations(chain)
    expect(operation.regions).toHaveLength(1)
    expect(operation.regions[0].outer.type).toBe('polygon')
    expect(operation.regions[0].holes).toHaveLength(1)
  })

  it('keeps disjoint profiles as separate regions', () => {
    const pair = sketch('pair', [
      { id: 'left', type: 'circle', center: [0, 0], radius: 4, construction: false },
      { id: 'right', type: 'circle', center: [40, 0], radius: 4, construction: false },
    ])
    const feature = extrude('extrude-pair', 'pair', 'newBody')

    const chain = buildOperationChain(feature, [pair, feature])
    const [operation] = extrusionOperations(chain)
    expect(operation.regions).toHaveLength(2)
    expect(operation.regions.every((region) => region.holes.length === 0)).toBe(true)
  })

  it('preserves a selected-edge fillet as a separate operation after an extrusion', () => {
    const plate = sketch('plate', rectangle('plate', [0, 0], [40, 20]))
    const base = extrude('extrude-plate', 'plate', 'newBody')
    const fillet: Feature = {
      id: 'fillet-top', kind: 'fillet', name: 'fillet-top', position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
      parameters: { radius: 2 },
      edges: [{ point: [20, 0, 10], start: [0, 0, 10], end: [40, 0, 10] }],
    }

    const chain = buildOperationChain(fillet, [plate, base, fillet])

    expect(chain.map((operation) => operation.type)).toEqual(['extrude', 'fillet'])
    expect(chain[1]).toMatchObject({ type: 'fillet', radius: 2, edges: fillet.edges })
  })

  it('skips features whose sketch is missing or open instead of aborting the chain', () => {
    const good = sketch('good', rectangle('good', [0, 0], [10, 10]))
    const open = sketch('open', [{ id: 'stray', type: 'line', start: [0, 0], end: [5, 0], construction: false }])
    const goodExtrude = extrude('extrude-good', 'good', 'newBody')
    const openExtrude = extrude('extrude-open', 'open', 'add')
    const orphan = extrude('extrude-orphan', 'deleted-sketch', 'add')
    const features: Feature[] = [good, goodExtrude, open, openExtrude, orphan]

    const chain = buildOperationChain(orphan, features)
    expect(chain.map((operation) => operation.featureId)).toEqual(['extrude-good'])
  })

  it('is a pure function of the document, so it can key the evaluation cache', () => {
    const plate = sketch('plate', rectangle('plate', [0, 0], [40, 20]))
    const feature = extrude('extrude-plate', 'plate', 'newBody')
    const features: Feature[] = [plate, feature]

    const first = JSON.stringify(buildOperationChain(feature, features))
    const second = JSON.stringify(buildOperationChain(feature, features))
    expect(first).toBe(second)

    const resized = extrude('extrude-plate', 'plate', 'newBody', 25)
    expect(JSON.stringify(buildOperationChain(resized, [plate, resized]))).not.toBe(first)
  })
})
