import * as THREE from 'three'
import { planeNormalDistance } from './extrude-direction'
import type { ExtrudeFeature, RevolveFeature, Feature, SketchFeature } from './model'
import { arcAlong, getProfileRegions, profileOutline, type ClosedProfile, type ProfileRegion } from './sketch'

function traceProfile(target: THREE.Shape | THREE.Path, profile: ClosedProfile) {
  if (profile.type === 'circle') {
    target.absarc(profile.center[0], profile.center[1], profile.radius, 0, Math.PI * 2, false)
    return
  }
  if (profile.type === 'polygon') {
    target.moveTo(...profile.points[0])
    for (const point of profile.points.slice(1)) target.lineTo(...point)
    target.closePath()
    return
  }
  target.moveTo(...profile.segments[0].start)
  for (const segment of profile.segments) {
    if (segment.kind === 'line') {
      target.lineTo(...segment.end)
      continue
    }
    const arc = arcAlong(segment)
    // absarc's last argument asks whether to sweep clockwise, which is exactly
    // the direction this boundary travels the arc.
    target.absarc(segment.center[0], segment.center[1], segment.radius,
      segment.clockwise ? arc.endAngle : arc.startAngle,
      segment.clockwise ? arc.startAngle : arc.endAngle,
      segment.clockwise)
  }
  target.closePath()
}

function shapeFromRegion(region: ProfileRegion) {
  const shape = new THREE.Shape()
  traceProfile(shape, region.outer)
  for (const hole of region.holes) {
    const path = new THREE.Path()
    traceProfile(path, hole)
    shape.holes.push(path)
  }
  return shape
}

/** Move a sketch-space extrusion onto its sketch plane in world space. */
function orientToSketchPlane(geometry: THREE.BufferGeometry, sketch: SketchFeature, symmetric: boolean, distance: number) {
  if (symmetric) geometry.translate(0, 0, -Math.abs(distance) / 2)
  else if (distance < 0) geometry.scale(1, 1, -1)

  if (sketch.plane === 'XZ') {
    geometry.applyMatrix4(new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 0, -1, -sketch.parameters.planeOffset,
      0, 1, 0, 0,
      0, 0, 0, 1,
    ))
  } else if (sketch.plane === 'YZ') {
    geometry.applyMatrix4(new THREE.Matrix4().set(
      0, 0, 1, sketch.parameters.planeOffset,
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    ))
  } else if (sketch.parameters.planeOffset) {
    geometry.translate(0, 0, sketch.parameters.planeOffset)
  }
  return geometry
}

/**
 * The volume this extrusion sweeps, before any boolean is applied. For a new
 * body that is the finished preview; for an add or cut it is the material about
 * to be fused or removed, which the viewport shows as a pending ghost.
 */
export function createExtrudeToolGeometry(feature: ExtrudeFeature, features: Feature[]): THREE.BufferGeometry {
  const sketch = features.find((candidate) => candidate.id === feature.sketchId)
  if (sketch?.kind !== 'sketch') return new THREE.BufferGeometry()
  const regions = getProfileRegions(sketch)
  if (!regions.length) return new THREE.BufferGeometry()

  // Matches the kernel exactly: a face-attached distance is already signed
  // along the face's outward normal. See extrude-direction.ts.
  const distance = planeNormalDistance(feature.parameters.distance, sketch.parameters.faceNormalSign)

  const geometry = new THREE.ExtrudeGeometry(regions.map(shapeFromRegion), {
    depth: Math.abs(distance),
    bevelEnabled: false,
    curveSegments: 64,
  })
  return orientToSketchPlane(geometry, sketch, feature.parameters.symmetric, distance)
}

/**
 * The volume this revolve sweeps, before any boolean is applied.
 */
export function createRevolveToolGeometry(feature: RevolveFeature, features: Feature[]): THREE.BufferGeometry {
  const sketch = features.find((candidate) => candidate.id === feature.sketchId)
  if (sketch?.kind !== 'sketch') return new THREE.BufferGeometry()
  const regions = getProfileRegions(sketch)
  if (!regions.length) return new THREE.BufferGeometry()

  const angle = feature.parameters.angle * (Math.PI / 180)

  // Extract point data from the region
  const points: THREE.Vector2[] = []

  // A simple lathe geometry preview for the outer profile
  // Note: Three.js LatheGeometry expects points to be provided as a sequence of Vector2.
  // We'll approximate this by extracting the points of the outer region.
  // profileOutline tessellates whichever boundary kind this is, so a profile
  // containing arcs lathes as its true shape rather than as its corner points.
  for (const p of profileOutline(regions[0].outer, 16)) {
    points.push(new THREE.Vector2(p[0], p[1]))
  }

  // LatheGeometry revolves around the Y axis by default
  const geometry = new THREE.LatheGeometry(points, 64, 0, angle)

  if (feature.parameters.axis === 'X') {
    // If the chosen axis is X, we must rotate the geometry so the lathe runs around X instead of Y
    geometry.rotateZ(-Math.PI / 2)
  }

  return orientToSketchPlane(geometry, sketch, false, 0)
}

/**
 * Preview geometry boundary. The exact B-rep evaluator will implement the same
 * feature-to-renderable contract in a Web Worker/WASM module.
 */
export function createPreviewGeometry(feature: Feature, features: Feature[] = []): THREE.BufferGeometry {
  switch (feature.kind) {
    case 'box': {
      const parameters = feature.parameters as { width: number; depth: number; height: number }
      return new THREE.BoxGeometry(parameters.width, parameters.depth, parameters.height)
    }
    case 'cylinder': {
      const parameters = feature.parameters as { radius: number; height: number }
      const geometry = new THREE.CylinderGeometry(parameters.radius, parameters.radius, parameters.height, 64)
      geometry.rotateX(Math.PI / 2)
      return geometry
    }
    case 'sphere': {
      const parameters = feature.parameters as { radius: number }
      return new THREE.SphereGeometry(parameters.radius, 64, 32)
    }
    case 'sketch':
      return new THREE.BufferGeometry()
    case 'extrude': {
      // An add or cut has no approximate form: the honest stand-in until
      // OpenCascade returns is the part as it stood before this feature. The
      // viewport marks that mesh provisional and ghosts the tool volume on top
      // rather than presenting an uncut solid as though it were finished.
      if (feature.operation !== 'newBody') {
        const featureIndex = features.findIndex((candidate) => candidate.id === feature.id)
        const previous = [...features.slice(0, featureIndex)].reverse().find((candidate) => candidate.kind === 'extrude' || candidate.kind === 'revolve')
        if (previous) return createPreviewGeometry(previous, features)
        return new THREE.BufferGeometry()
      }
      return createExtrudeToolGeometry(feature, features)
    }
    case 'revolve': {
      if (feature.operation !== 'newBody') {
        const featureIndex = features.findIndex((candidate) => candidate.id === feature.id)
        const previous = [...features.slice(0, featureIndex)].reverse().find((candidate) => candidate.kind === 'extrude' || candidate.kind === 'revolve')
        if (previous) return createPreviewGeometry(previous, features)
        return new THREE.BufferGeometry()
      }
      return createRevolveToolGeometry(feature, features)
    }
    case 'fillet':
      // Fillets are exact-only operations; the viewport keeps the preceding
      // solid visible until the selected-edge result arrives from OpenCascade.
      return new THREE.BufferGeometry()
  }
}
