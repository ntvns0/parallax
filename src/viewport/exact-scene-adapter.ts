import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { disposeEdgeMaterial } from './model-edges'

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        // Line materials are also held by the resize registry, which has to let
        // go of them here or it keeps disposed materials alive and re-resolves
        // them on every viewport resize.
        if (material instanceof LineMaterial) disposeEdgeMaterial(material)
        else material.dispose()
      })
    }
  })
}

export function createSolidMeshMaterial(selected: boolean, operation: string, inSketchContext: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: selected
      ? '#46685d'
      : operation === 'cut'
        ? '#3a4a50'
        : '#475350',
    metalness: 0.1,
    roughness: 0.38,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    transparent: inSketchContext,
    opacity: inSketchContext ? 0.35 : 1,
  })
}

export function createSolidEdgeMaterial(selected: boolean): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: selected ? '#8ff0cc' : '#94a39d',
    transparent: true,
    opacity: selected ? 0.95 : 0.45,
  })
}

export function createGhostMeshMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#344641',
    metalness: 0.05,
    roughness: 0.6,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  })
}
