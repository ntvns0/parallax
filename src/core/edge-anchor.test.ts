import { describe, expect, it } from 'vitest'
import { anchorEdgeReferences, currentEdgeReference, deriveEdgeAnchor, resolveEdgeAnchor } from './edge-anchor'
import type { Feature, FilletEdgeReference, SketchEntity, Vec2 } from './model'

/** A closed rectangle whose entity ids are stable, as the sketcher keeps them. */
function rectangle(prefix: string, cx: number, cy: number, width: number, height: number): SketchEntity[] {
  const corners: Vec2[] = [
    [cx - width / 2, cy - height / 2],
    [cx + width / 2, cy - height / 2],
    [cx + width / 2, cy + height / 2],
    [cx - width / 2, cy + height / 2],
  ]
  return corners.map((corner, index) => ({
    id: `${prefix}-${index}`,
    type: 'line',
    start: corner,
    end: corners[(index + 1) % 4],
    construction: false,
  }))
}

/**
 * A pocket 6mm deep cut into the top of a plate: a sketch on the XY plane at
 * z=20 extruded inward, which is the shape the reported bug was about.
 */
function pocketDocument(cx = 0, cy = 0, width = 40, height = 24, distance = -6): Feature[] {
  return [
    {
      id: 'sketch-2', kind: 'sketch', name: 'Sketch 2', plane: 'XY',
      parameters: { planeOffset: 20, faceNormalSign: 1 },
      entities: rectangle('line', cx, cy, width, height),
      constraints: [], position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    },
    {
      id: 'extrude-2', kind: 'extrude', name: 'Extrude 2',
      parameters: { distance, symmetric: false, edgeRadius: 0 },
      sketchId: 'sketch-2', operation: 'cut',
      position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    },
  ] as Feature[]
}

/** The vertical corner of the pocket at (+20, -12), running z=20 down to z=14. */
const pocketCorner: FilletEdgeReference = {
  start: [20, -12, 20], end: [20, -12, 14], point: [20, -12, 17],
}

/** The pocket's bottom rim along y=-12, at the far end of the sweep. */
const pocketFloorEdge: FilletEdgeReference = {
  start: [-20, -12, 14], end: [20, -12, 14], point: [0, -12, 14],
}

describe('deriveEdgeAnchor', () => {
  it('recognises a corner dragged along the sweep', () => {
    const anchor = deriveEdgeAnchor(pocketCorner, pocketDocument())

    expect(anchor).toMatchObject({ kind: 'profileLateral', sketchId: 'sketch-2' })
  })

  it('recognises the profile curve at the far end of the sweep', () => {
    const anchor = deriveEdgeAnchor(pocketFloorEdge, pocketDocument())

    expect(anchor).toMatchObject({ kind: 'profileSweep', sketchId: 'sketch-2', entityId: 'line-0', depth: 1 })
  })

  it('recognises the profile curve at the sketch plane itself', () => {
    const rim: FilletEdgeReference = { start: [-20, -12, 20], end: [20, -12, 20], point: [0, -12, 20] }

    expect(deriveEdgeAnchor(rim, pocketDocument())).toMatchObject({ depth: 0 })
  })

  it('leaves an edge no sketch explains unanchored', () => {
    // A fillet's own tangent boundary sits 2mm inside the pocket wall.
    const filletGenerated: FilletEdgeReference = {
      start: [18, -12, 20], end: [18, -12, 14], point: [18, -12, 17],
    }

    expect(deriveEdgeAnchor(filletGenerated, pocketDocument())).toBeUndefined()
  })

  it('ignores construction geometry, which sweeps nothing', () => {
    const features = pocketDocument()
    const sketch = features[0] as Extract<Feature, { kind: 'sketch' }>
    sketch.entities = sketch.entities.map((entity) => ({ ...entity, construction: true }))

    expect(deriveEdgeAnchor(pocketCorner, features)).toBeUndefined()
  })
})

describe('resolveEdgeAnchor', () => {
  it('follows the pocket when the sketch moves', () => {
    // The reported workflow: an engineer nudges the pocket 5mm and expects the
    // fillet to come with it.
    const anchor = deriveEdgeAnchor(pocketCorner, pocketDocument())!
    const resolved = resolveEdgeAnchor(anchor, pocketDocument(5, 0))

    expect(resolved?.start).toEqual([25, -12, 20])
    expect(resolved?.end).toEqual([25, -12, 14])
  })

  it('follows the pocket when it is resized', () => {
    const anchor = deriveEdgeAnchor(pocketCorner, pocketDocument())!
    const resolved = resolveEdgeAnchor(anchor, pocketDocument(0, 0, 60, 24))

    expect(resolved?.start).toEqual([30, -12, 20])
  })

  it('follows a change of extrusion depth', () => {
    const anchor = deriveEdgeAnchor(pocketFloorEdge, pocketDocument())!
    const resolved = resolveEdgeAnchor(anchor, pocketDocument(0, 0, 40, 24, -9))

    expect(resolved?.point[2]).toBeCloseTo(11)
  })

  it('round-trips unchanged when nothing moved', () => {
    const anchor = deriveEdgeAnchor(pocketCorner, pocketDocument())!
    const resolved = resolveEdgeAnchor(anchor, pocketDocument())

    expect(resolved?.start).toEqual(pocketCorner.start)
    expect(resolved?.end).toEqual(pocketCorner.end)
  })

  it('gives up when the entity it named was deleted', () => {
    const anchor = deriveEdgeAnchor(pocketCorner, pocketDocument())!
    const features = pocketDocument()
    const sketch = features[0] as Extract<Feature, { kind: 'sketch' }>
    sketch.entities = sketch.entities.filter((entity) => entity.id !== anchor.entityId)

    expect(resolveEdgeAnchor(anchor, features)).toBeNull()
  })
})

describe('currentEdgeReference', () => {
  it('re-derives an anchored edge against the moved document', () => {
    const [anchored] = anchorEdgeReferences([pocketCorner], pocketDocument())
    const current = currentEdgeReference(anchored, pocketDocument(5, 0))

    expect(current.start).toEqual([25, -12, 20])
  })

  it('falls back to the stored coordinates when the anchor stops resolving', () => {
    const [anchored] = anchorEdgeReferences([pocketCorner], pocketDocument())
    const current = currentEdgeReference(anchored, [])

    expect(current.start).toEqual(pocketCorner.start)
  })

  it('leaves an unanchored edge exactly as it was', () => {
    const current = currentEdgeReference(pocketCorner, pocketDocument(5, 0))

    expect(current).toEqual(pocketCorner)
  })
})

describe('two extrusions from one sketch', () => {
  /** The same profile extruded twice, to different depths. */
  function sharedSketchDocument(): Feature[] {
    const features = pocketDocument()
    features.push({
      id: 'extrude-3', kind: 'extrude', name: 'Extrude 3',
      parameters: { distance: -12, symmetric: false, edgeRadius: 0 },
      sketchId: 'sketch-2', operation: 'cut',
      position: [0, 0, 0], rotation: [0, 0, 0], visible: true,
    } as Feature)
    return features
  }

  it('records which extrusion swept the edge', () => {
    const anchor = deriveEdgeAnchor(pocketCorner, sharedSketchDocument())
    expect(anchor?.featureId).toBe('extrude-2')
  })

  // Without the recorded id both anchors resolve against whichever extrusion
  // comes first, so the deeper pocket's floor would be reported at the shallow
  // one's depth.
  it('resolves each edge against its own extrusion', () => {
    const features = sharedSketchDocument()
    const shallow = deriveEdgeAnchor(pocketFloorEdge, features)!
    const deep = { ...shallow, featureId: 'extrude-3' }

    expect(resolveEdgeAnchor(shallow, features)?.start[2]).toBeCloseTo(14, 9)
    expect(resolveEdgeAnchor(deep, features)?.start[2]).toBeCloseTo(8, 9)
  })

  it('still resolves an anchor saved without a feature id', () => {
    const features = sharedSketchDocument()
    const anchor = deriveEdgeAnchor(pocketFloorEdge, features)!
    const legacy = { ...anchor }
    delete legacy.featureId
    expect(resolveEdgeAnchor(legacy, features)?.start[2]).toBeCloseTo(14, 9)
  })
})
