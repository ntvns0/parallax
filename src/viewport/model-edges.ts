import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/**
 * The edges drawn on a solid.
 *
 * Three's ordinary `LineBasicMaterial` draws one-pixel hardware lines: their
 * width cannot be set, they alias badly on a diagonal, and they thin out to
 * near-invisibility on a high-density display. Edges are how a mechanical part
 * is read — they carry the form far more than the shaded surface does — so they
 * are drawn instead as camera-facing quads through `LineSegments2`, which can
 * be given a real width in pixels.
 *
 * The cost is that `LineSegments2` is a `Mesh`, not a `LineSegments`, and its
 * geometry stores endpoints as instanced attributes rather than as a `position`
 * attribute. Nothing may therefore read display edges to find out where the
 * model's edges are; `edgeSource` below carries that separately.
 */

/** Line widths in pixels, independent of device pixel ratio. */
const EDGE_WIDTH = 1.6
const EDGE_WIDTH_SELECTED = 2.4

/**
 * Where a solid's edges actually are, kept apart from how they are drawn.
 *
 * Measurement snapping needs edge endpoints, vertices, and the grouping that
 * says which segments belong to one topological edge. It used to read those off
 * the rendered object, which quietly made the picking behaviour a function of
 * the material in use. This is the same data in source form: a plain position
 * attribute plus the kernel's edge groups.
 */
export type EdgeSource = {
  /** Changes whenever the edges do, so caches keyed on it invalidate. */
  id: string
  positions: THREE.Float32BufferAttribute
  edgeGroups?: { start: number; count: number }[]
}

let nextEdgeSourceId = 0

/** Read the edge source recorded on a solid mesh, if it has one. */
export function edgeSourceOf(mesh: THREE.Object3D): EdgeSource | null {
  const source = mesh.userData.edgeSource as EdgeSource | undefined
  return source?.positions ? source : null
}

function attachEdgeSource(mesh: THREE.Object3D, positions: THREE.Float32BufferAttribute, edgeGroups?: { start: number; count: number }[]): void {
  nextEdgeSourceId += 1
  mesh.userData.edgeSource = { id: `edges-${nextEdgeSourceId}`, positions, edgeGroups } satisfies EdgeSource
}

/**
 * Every line material in the scene, so a resize can refresh them all.
 *
 * `LineMaterial` computes its width in clip space and therefore has to be told
 * the drawing-buffer size. A material that misses a resize draws at the wrong
 * width until something else rebuilds it — a subtle wrongness rather than an
 * obvious failure, which is why the registry is global rather than per-mesh.
 */
const lineMaterials = new Set<LineMaterial>()
const resolution = new THREE.Vector2(1, 1)

export function setEdgeResolution(width: number, height: number): void {
  resolution.set(width, height)
  for (const material of lineMaterials) material.resolution.copy(resolution)
}

export function createEdgeMaterial(color: string, opacity: number, selected = false): LineMaterial {
  const material = new LineMaterial({
    color: new THREE.Color(color).getHex(),
    linewidth: selected ? EDGE_WIDTH_SELECTED : EDGE_WIDTH,
    transparent: opacity < 1,
    opacity,
    // Edges sit exactly on the surface they bound, so without a depth bias they
    // fight with it and stipple as the camera moves.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
  material.resolution.copy(resolution)
  lineMaterials.add(material)
  return material
}

export function disposeEdgeMaterial(material: LineMaterial): void {
  lineMaterials.delete(material)
  material.dispose()
}

/** Build the drawn edges for a solid, and record where those edges are. */
export function createModelEdges(host: THREE.Object3D, positions: THREE.Float32BufferAttribute, color: string, opacity: number, selected = false): LineSegments2 {
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(Array.from(positions.array))
  const edges = new LineSegments2(geometry, createEdgeMaterial(color, opacity, selected))
  // Picking goes through the solid and the edge source, never through this.
  edges.raycast = () => undefined
  edges.renderOrder = 1
  attachEdgeSource(host, positions)
  return edges
}

/** Replace a solid's drawn edges and edge source with an exact-kernel result. */
export function updateModelEdges(host: THREE.Object3D, edges: LineSegments2, edgeLines: number[], edgeGroups: { start: number; count: number }[]): void {
  edges.geometry.dispose()
  const geometry = new LineSegmentsGeometry()
  if (edgeLines.length >= 6) geometry.setPositions(edgeLines)
  edges.geometry = geometry
  attachEdgeSource(host, new THREE.Float32BufferAttribute(edgeLines, 3), edgeGroups)
}

export function setEdgeAppearance(edges: LineSegments2, color: string, opacity: number, selected: boolean): void {
  const material = edges.material as LineMaterial
  material.color.set(color)
  material.opacity = opacity
  material.transparent = opacity < 1
  material.linewidth = selected ? EDGE_WIDTH_SELECTED : EDGE_WIDTH
}

export { LineSegments2 }
