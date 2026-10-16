import * as THREE from 'three'
import { planeNormalDistance } from './extrude-direction'
import type { ExtrudeFeature, RevolveFeature, Feature, SketchFeature } from './model'
import { revolveAxisInSketch } from './revolve-axis'
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

  const axis = revolveAxisInSketch(feature, sketch)
  if (!axis) return new THREE.BufferGeometry()
  const angle = feature.parameters.angle * (Math.PI / 180)

  // LatheGeometry turns (radius, height) points about its own Y axis, so each
  // outline point is measured from the revolve axis: how far along it, and
  // how far out from it. profileOutline tessellates curves, so a profile with
  // arcs lathes as its true shape rather than as its corner points.
  const [dx, dy] = axis.direction
  const across: [number, number] = [-dy, dx]
  const outline = profileOutline(regions[0].outer, 16)
  const offsets = outline.map(([x, y]) => [x - axis.origin[0], y - axis.origin[1]] as const)
  const side = Math.sign(offsets.map(([x, y]) => x * across[0] + y * across[1]).find((value) => Math.abs(value) > 1e-9) ?? 1) || 1
  const points = offsets.map(([x, y]) => new THREE.Vector2(Math.abs(x * across[0] + y * across[1]), x * dx + y * dy))

  // Starting a quarter turn in puts the first copy of the profile in the
  // sketch plane, on the side it was drawn, and sweeps right-handed about the
  // axis direction as the exact revolve does.
  const geometry = new THREE.LatheGeometry(points, 64, Math.PI / 2, angle)
  const outward = new THREE.Vector3(across[0] * side, across[1] * side, 0)
  const along = new THREE.Vector3(dx, dy, 0)
  geometry.applyMatrix4(new THREE.Matrix4()
    .makeBasis(outward, along, new THREE.Vector3().crossVectors(outward, along))
    .setPosition(axis.origin[0], axis.origin[1], 0))

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
    case 'hole':
      // Fillets and holes are exact-only operations; the viewport keeps the
      // preceding solid visible until the result arrives from OpenCascade.
      return new THREE.BufferGeometry()
  }
}
