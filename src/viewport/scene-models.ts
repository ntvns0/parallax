import * as THREE from 'three'
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { useDocumentStore } from '../core/document-store'
import { attributeFaces } from '../core/face-ownership'
import { createExtrudeToolGeometry, createPreviewGeometry, createRevolveToolGeometry } from '../core/geometry'
import { modifiesPreviousSolid, type ExtrudeFeature, type Feature, type RevolveFeature, type SketchFeature } from '../core/model'
import { evaluateViewportMesh, kernelMeshToGeometry } from '../kernel/exact-kernel'
import { disposeObject } from './exact-scene-adapter'
import { faceGroupSamples } from './face-geometry'
import { createModelEdges, LineSegments2, setEdgeAppearance, updateModelEdges } from './model-edges'
import { isSolid, planSolidRender } from './render-plan'
import { sketchWirePositions } from './sketch-wire'
import type { ViewportController } from './viewport-controller'

const PRIMITIVE_KINDS = new Set(['box', 'cylinder', 'sphere'])

/** What in the document changes the scene. Selection does not; it only recolours. */
function documentGeometrySignature() {
  return JSON.stringify(useDocumentStore.getState().document.features.map((feature) => ({
    id: feature.id,
    kind: feature.kind,
    visible: feature.visible,
    position: feature.position,
    rotation: feature.rotation,
    parameters: feature.parameters,
    bodyId: feature.bodyId,
    ...(feature.kind === 'sketch' ? { plane: feature.plane, entities: feature.entities, attachment: feature.attachment } : {}),
    ...(feature.kind === 'extrude' || feature.kind === 'revolve' ? { sketchId: feature.sketchId, operation: feature.operation } : {}),
    ...(feature.kind === 'hole' ? { sketchId: feature.sketchId } : {}),
    ...(feature.kind === 'pattern' ? { featureIds: feature.featureIds } : {}),
    ...(feature.kind === 'fillet' ? { edges: feature.edges } : {}),
    ...(feature.kind === 'shell' ? { faces: feature.faces } : {}),
  })))
}

/**
 * The part in the scene: a mesh per solid, a wire per sketch, a ghost per
 * operation still waiting on the kernel, and the tint on the selected feature.
 *
 * A rebuild draws the fast preview geometry at once, then swaps in each exact
 * B-rep mesh as the kernel returns it. `data-exact-features` on the host lists
 * the features whose exact solid is on screen, and `data-pending-exact` is set
 * while a ghost waits; the browser tests read both.
 */
export class SceneModels {
  /** Solid meshes by feature id. Picking, snapping, and push/pull all look here. */
  readonly meshes = new Map<string, THREE.Mesh>()
  private readonly sketchLines = new Map<string, THREE.LineSegments>()
  private readonly pendingGhosts = new Map<string, THREE.Mesh>()
  private readonly exactFeatures = new Set<string>()
  private featureHighlight: THREE.Mesh | null = null
  private generation = 0
  private signature = ''

  constructor(
    private readonly controller: ViewportController,
    private readonly host: HTMLElement,
    private readonly transform: TransformControls,
    private readonly options: {
      /** Called as the models are torn down, for anything that points into them. */
      onDispose: () => void
      /** Whether the move gizmo may attach to a selected primitive now. */
      canAttachGizmo: () => boolean
      /** Called when the solids on screen change: after a rebuild, and as each exact solid arrives. */
      onSolidsChanged: () => void
    },
  ) {}

  /** Rebuild if the geometry changed, else only restyle for the selection. */
  documentChanged() {
    if (documentGeometrySignature() !== this.signature) this.rebuild()
    else this.updateSelection()
  }

  rebuild() {
    const generation = ++this.generation
    this.dispose()
    const { document, selectedId } = useDocumentStore.getState()
    this.signature = documentGeometrySignature()
    const plan = planSolidRender(document.features)
    for (const feature of document.features) {
      if (!feature.visible) continue
      if (isSolid(feature) && !plan.rendered.has(feature.id)) continue
      if (feature.kind === 'sketch') {
        this.addSketch(feature, feature.id === selectedId)
        continue
      }
      const mesh = this.addPreviewMesh(feature, document.features, feature.id === selectedId)
      if (!isSolid(feature)) continue
      const sketch = feature.kind === 'extrude' || feature.kind === 'revolve'
        ? document.features.find((candidate) => candidate.id === feature.sketchId)
        : undefined
      if ((feature.kind === 'extrude' || feature.kind === 'revolve') && feature.operation !== 'newBody') this.addPendingGhost(feature, document.features)
      if (!modifiesPreviousSolid(feature) && sketch?.kind !== 'sketch') continue
      void evaluateViewportMesh(feature, sketch?.kind === 'sketch' ? sketch : undefined, document.features).then((result) => {
        if (result.status === 'superseded') return
        if (generation !== this.generation || this.meshes.get(feature.id) !== mesh) return
        for (const supersededId of plan.supersedes.get(feature.id) ?? []) {
          const previous = this.meshes.get(supersededId)
          if (!previous) continue
          previous.removeFromParent()
          disposeObject(previous)
          this.meshes.delete(supersededId)
          this.exactFeatures.delete(supersededId)
        }
        this.resolvePendingGhost(feature.id)
        mesh.geometry.dispose()
        mesh.geometry = kernelMeshToGeometry(result.mesh)
        const edges = mesh.children[0]
        if (edges instanceof LineSegments2) updateModelEdges(mesh, edges, result.mesh.edgeLines, result.mesh.edgeGroups)
        this.exactFeatures.add(feature.id)
        this.publishExactFeatures()
        this.controller.requestRender()
        this.updateSelection()
        this.fitLighting()
        this.options.onSolidsChanged()
      }).catch(() => {})
    }
    this.updateSelection()
    this.fitLighting()
    this.options.onSolidsChanged()
  }

  /** Colour everything for the current selection and mode, and place the move gizmo. */
  updateSelection() {
    this.controller.requestRender()
    const state = useDocumentStore.getState()
    const selectedId = state.selectedId
    const sketching = Boolean(state.activeSketchId)
    this.transform.detach()
    const selectedFeature = selectedId ? state.document.features.find((candidate) => candidate.id === selectedId) : undefined
    const selectedIsPrimitive = PRIMITIVE_KINDS.has(selectedFeature?.kind ?? '')

    for (const [id, mesh] of this.meshes) {
      const provisional = this.pendingGhosts.has(id)
      const tinted = selectedIsPrimitive && id === selectedId
      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.color.set(tinted ? '#76e2ba' : sketching ? '#93a49d' : '#b8c7c1')
        mesh.material.transparent = sketching || provisional
        mesh.material.opacity = provisional ? 0.5 : sketching ? 0.68 : 1
      }
      const edge = mesh.children[0]
      if (edge instanceof LineSegments2) {
        setEdgeAppearance(
          edge,
          // While sketching, edges are what a user traces and snaps by eye,
          // so they stay brighter than the translucent faces around them.
          tinted ? '#d8fff0' : sketching ? '#a9c8bc' : '#1b2320',
          tinted ? 0.95 : sketching ? 0.9 : 0.82,
          tinted,
        )
      }
    }
    this.updateFeatureHighlight(sketching || selectedIsPrimitive ? null : selectedId)
    for (const [id, lines] of this.sketchLines) {
      if (lines.material instanceof THREE.LineBasicMaterial) lines.material.color.set(id === selectedId ? '#9affd8' : '#68a68f')
    }
    const selectedMesh = selectedId ? this.meshes.get(selectedId) : undefined
    if (selectedMesh && selectedIsPrimitive && !sketching && this.options.canAttachGizmo()) this.transform.attach(selectedMesh)
  }

  dispose() {
    this.controller.requestRender()
    this.options.onDispose()
    this.transform.detach()
    const { modelGroup } = this.controller
    disposeObject(modelGroup)
    modelGroup.clear()
    this.featureHighlight = null
    this.meshes.clear()
    this.sketchLines.clear()
    this.pendingGhosts.clear()
    delete this.host.dataset.pendingExact
    this.exactFeatures.clear()
    this.publishExactFeatures()
  }

  private publishExactFeatures() {
    if (this.exactFeatures.size) this.host.dataset.exactFeatures = [...this.exactFeatures].join(' ')
    else delete this.host.dataset.exactFeatures
  }

  private addPreviewMesh(feature: Exclude<Feature, SketchFeature>, features: Feature[], selected: boolean) {
    const geometry = modifiesPreviousSolid(feature) ? new THREE.BufferGeometry() : createPreviewGeometry(feature, features)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: selected ? '#76e2ba' : '#b8c7c1',
      roughness: 0.58,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }))
    mesh.position.set(...feature.position)
    mesh.rotation.set(...feature.rotation)
    mesh.userData.featureId = feature.id
    const previewEdges = geometry.getAttribute('position') ? new THREE.EdgesGeometry(geometry, 28) : new THREE.BufferGeometry()
    const previewPositions = previewEdges.getAttribute('position')
    const edges = createModelEdges(
      mesh,
      new THREE.Float32BufferAttribute(previewPositions ? Array.from(previewPositions.array) : [], 3),
      selected ? '#d8fff0' : '#1b2320',
      selected ? 0.95 : 0.82,
      selected,
    )
    previewEdges.dispose()
    mesh.add(edges)
    this.controller.modelGroup.add(mesh)
    this.meshes.set(feature.id, mesh)
    return mesh
  }

  private addSketch(feature: SketchFeature, selected: boolean) {
    const wire = sketchWirePositions(feature)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(wire.profile, 3))
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: selected ? '#9affd8' : '#68a68f' }))
    lines.userData.featureId = feature.id
    if (wire.construction.length) {
      const constructionGeometry = new THREE.BufferGeometry()
      constructionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wire.construction, 3))
      const construction = new THREE.LineSegments(constructionGeometry, new THREE.LineDashedMaterial({
        color: '#68a68f', dashSize: 3, gapSize: 2, transparent: true, opacity: 0.7,
      }))
      construction.computeLineDistances()
      lines.add(construction)
    }
    this.controller.modelGroup.add(lines)
    this.sketchLines.set(feature.id, lines)
  }

  /** The tool body of an add or cut, shown translucent until the exact boolean arrives. */
  private addPendingGhost(feature: ExtrudeFeature | RevolveFeature, features: Feature[]) {
    const geometry = feature.kind === 'revolve' ? createRevolveToolGeometry(feature, features) : createExtrudeToolGeometry(feature, features)
    if (!geometry.getAttribute('position')?.count) {
      geometry.dispose()
      return
    }
    const removing = feature.operation === 'cut'
    const ghost = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: removing ? '#e08787' : '#7fe0b8', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    }))
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 28),
      new THREE.LineBasicMaterial({ color: removing ? '#f2b0b0' : '#9affd8', transparent: true, opacity: 0.9, depthTest: false }),
    )
    outline.raycast = () => undefined
    ghost.raycast = () => undefined
    ghost.add(outline)
    ghost.renderOrder = 15
    this.controller.modelGroup.add(ghost)
    this.pendingGhosts.set(feature.id, ghost)
    this.host.dataset.pendingExact = feature.operation
  }

  private resolvePendingGhost(featureId: string) {
    const ghost = this.pendingGhosts.get(featureId)
    if (!ghost) return
    ghost.removeFromParent()
    disposeObject(ghost)
    this.pendingGhosts.delete(featureId)
    if (!this.pendingGhosts.size) delete this.host.dataset.pendingExact
  }

  /**
   * Tint the faces of the final solid that the selected feature made. Faces are
   * attributed to features by sampling them, since the exact mesh is one body.
   */
  private updateFeatureHighlight(selectedId: string | null) {
    if (this.featureHighlight) {
      this.featureHighlight.removeFromParent()
      disposeObject(this.featureHighlight)
      this.featureHighlight = null
    }
    if (!selectedId) return
    const hostMesh = [...this.meshes.values()].at(-1)
    if (!hostMesh?.geometry.getAttribute('position')) return
    const { samples, groups } = faceGroupSamples(hostMesh.geometry)
    if (!samples.length) return
    const owners = attributeFaces(samples, useDocumentStore.getState().document.features)
    const owned = groups.filter((_, index) => owners[index] === selectedId)
    if (!owned.length) return

    const sourceIndex = hostMesh.geometry.index!
    const sourcePositions = hostMesh.geometry.getAttribute('position')
    const sourceNormals = hostMesh.geometry.getAttribute('normal')
    const positions: number[] = []
    const normals: number[] = []
    for (const group of owned) {
      for (let offset = group.start; offset < group.start + group.count; offset += 1) {
        const vertex = sourceIndex.getX(offset)
        positions.push(sourcePositions.getX(vertex), sourcePositions.getY(vertex), sourcePositions.getZ(vertex))
        if (sourceNormals) normals.push(sourceNormals.getX(vertex), sourceNormals.getY(vertex), sourceNormals.getZ(vertex))
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    if (normals.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    this.featureHighlight = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: '#76e2ba',
      emissive: '#2f9e78',
      emissiveIntensity: 0.55,
      roughness: 0.42,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }))
    this.featureHighlight.raycast = () => undefined
    this.featureHighlight.renderOrder = 4
    this.controller.modelGroup.add(this.featureHighlight)
  }

  private fitLighting() {
    const box = new THREE.Box3().setFromObject(this.controller.modelGroup)
    if (box.isEmpty()) return
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    if (sphere.radius > 0.001) this.controller.updateLightingForBounds(sphere.center, sphere.radius)
  }
}
