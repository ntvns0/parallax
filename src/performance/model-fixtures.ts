import {
  CURRENT_SCHEMA_VERSION,
  type CadDocument,
  type ExtrudeFeature,
  type Feature,
  type LineEntity,
  type SketchFeature,
} from '../core/model'

function rectangle(id: string, x: number, y: number, width: number, height: number): LineEntity[] {
  const corners: [number, number][] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
  return corners.map((start, index) => ({
    id: `${id}-edge-${index}`,
    type: 'line',
    start,
    end: corners[(index + 1) % corners.length],
    construction: false,
  }))
}

/**
 * A deterministic, kernel-free feature history for repeatable performance work.
 * Each step adds a closed sketch and an extrusion, resembling a long linear
 * part history without making benchmark results depend on WebAssembly startup.
 */
export function createLinearPartFixture(stepCount: number): CadDocument {
  const features: Feature[] = []
  for (let index = 0; index < stepCount; index += 1) {
    const sketchId = `fixture-sketch-${index}`
    const sketch: SketchFeature = {
      id: sketchId,
      kind: 'sketch',
      name: `Fixture Sketch ${index + 1}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      plane: 'XY',
      parameters: { planeOffset: index % 7 },
      entities: rectangle(sketchId, index * 2, index % 11, 20 + index % 5, 12 + index % 3),
      constraints: [],
    }
    const extrude: ExtrudeFeature = {
      id: `fixture-extrude-${index}`,
      kind: 'extrude',
      name: `Fixture Extrude ${index + 1}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      sketchId,
      operation: index === 0 ? 'newBody' : index % 3 === 0 ? 'cut' : 'add',
      parameters: { distance: 5 + index % 13, symmetric: index % 10 === 0, edgeRadius: 0 },
    }
    features.push(sketch, extrude)
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `linear-part-${stepCount}`,
    name: `${stepCount}-step performance fixture`,
    units: 'mm',
    displayUnits: 'mm',
    features,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
