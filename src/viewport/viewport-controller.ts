import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { syncOrbitControlsUp } from '../adapters/orbit-controls-adapter'
import type { SketchPlane, Vec2 } from '../core/model'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { fitCameraToRadius } from './camera-fit'
import { fogDensityForRadius } from './fog-fit'
import { setEdgeResolution } from './model-edges'
import { ambientOcclusionRadius } from './ao-fit'

export type CameraView =
  | 'home'
  | 'top'
  | 'bottom'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'isometric'
  | 'dimetric'
  | 'trimetric'
  | 'fit'

export class ViewportController {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly orbit: OrbitControls
  readonly modelGroup: THREE.Group
  readonly measurementGroup: THREE.Group

  private readonly ambientLight: THREE.HemisphereLight
  private readonly keyLight: THREE.DirectionalLight
  private readonly fillLight: THREE.DirectionalLight
  private readonly rimLight: THREE.DirectionalLight
  private readonly viewLight: THREE.DirectionalLight

  private animationFrameId: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private isDisposed = false

  /**
   * The composed render path, when the browser could build one.
   *
   * Ambient occlusion is a refinement, not a requirement: a context that cannot
   * allocate the extra targets should still get a working viewport rather than
   * a blank one, so this stays null and the loop renders directly.
   */
  private composer: EffectComposer | null = null
  private ambientOcclusion: GTAOPass | null = null

  private lastModelBounds = { center: new THREE.Vector3(0, 0, 0), radius: 60 }
  private onCameraDistanceCallback?: (distance: number) => void
  private lastReportedDistance = 0

  constructor(host: HTMLElement, options?: { onCameraDistanceChange?: (distance: number) => void }) {
    this.onCameraDistanceCallback = options?.onCameraDistanceChange

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#181b1b')
    this.scene.fog = new THREE.FogExp2('#181b1b', 0.0015)

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10000)
    this.camera.position.set(115, -135, 95)
    this.camera.up.set(0, 0, 1)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    host.appendChild(this.renderer.domElement)

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.075
    this.orbit.screenSpacePanning = true
    this.orbit.target.set(0, 0, 10)
    this.orbit.minDistance = 4
    this.orbit.maxDistance = 2400

    const grid = new THREE.GridHelper(800, 80, '#5d6662', '#303635')
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.025
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
    gridMaterials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.38
      material.depthWrite = false
    })
    this.scene.add(grid)

    const axes = new THREE.AxesHelper(42)
    axes.position.z = 0.05
    this.scene.add(axes)

    this.ambientLight = new THREE.HemisphereLight('#dff6ef', '#252a29', 0.3)
    this.ambientLight.position.set(0, 0, 1)
    this.scene.add(this.ambientLight)

    this.keyLight = new THREE.DirectionalLight('#fff7e8', 1.8)
    this.fillLight = new THREE.DirectionalLight('#e8f2ff', 0.3)
    this.rimLight = new THREE.DirectionalLight('#dff6ef', 0.2)
    this.scene.add(this.keyLight, this.fillLight, this.rimLight)
    this.scene.add(this.keyLight.target, this.fillLight.target, this.rimLight.target)

    this.viewLight = new THREE.DirectionalLight('#eef6f2', 0.45)
    this.scene.add(this.viewLight, this.viewLight.target)

    this.modelGroup = new THREE.Group()
    this.scene.add(this.modelGroup)

    this.measurementGroup = new THREE.Group()
    this.measurementGroup.renderOrder = 30
    this.scene.add(this.measurementGroup)

    this.setupComposer()

    this.resizeObserver = new ResizeObserver(() => this.resize(host))
    this.resizeObserver.observe(host)
    this.resize(host)

    this.startRenderLoop()
  }

  /**
   * Build the ambient-occlusion render path.
   *
   * Contact darkening in concave corners is most of what lets a shaded surface
   * read as a shape rather than a silhouette — a pocket and a printed rectangle
   * look identical without it. `OutputPass` is required at the end because a
   * composed path bypasses the renderer's own tone mapping and colour-space
   * conversion, and dropping it washes the whole viewport out.
   */
  private setupComposer(): void {
    try {
      const composer = new EffectComposer(this.renderer)
      composer.addPass(new RenderPass(this.scene, this.camera))

      const ao = new GTAOPass(this.scene, this.camera, 1, 1)
      ao.blendIntensity = 0.7
      ao.updateGtaoMaterial({
        radius: ambientOcclusionRadius(this.lastModelBounds.radius),
        distanceExponent: 1,
        thickness: 1,
        scale: 1,
        samples: 16,
      })
      composer.addPass(ao)
      composer.addPass(new OutputPass())

      this.composer = composer
      this.ambientOcclusion = ao
    } catch {
      // Left null; the loop falls back to rendering the scene directly.
      this.composer = null
      this.ambientOcclusion = null
    }
  }

  private lastCameraQuaternion = new THREE.Quaternion()
  private lastCameraPosition = new THREE.Vector3()

  private startRenderLoop(): void {
    const loop = () => {
      if (this.isDisposed) return
      this.animationFrameId = requestAnimationFrame(loop)
      this.orbit.update()

      this.viewLight.position.copy(this.camera.position)
      this.viewLight.target.position.copy(this.orbit.target)
      this.viewLight.target.updateMatrixWorld()

      if (this.composer) this.composer.render()
      else this.renderer.render(this.scene, this.camera)

      if (!this.lastCameraQuaternion.equals(this.camera.quaternion) || !this.lastCameraPosition.equals(this.camera.position)) {
        this.lastCameraQuaternion.copy(this.camera.quaternion)
        this.lastCameraPosition.copy(this.camera.position)
        window.dispatchEvent(new CustomEvent('parallax:camera-change', {
          detail: {
            quaternion: [this.camera.quaternion.x, this.camera.quaternion.y, this.camera.quaternion.z, this.camera.quaternion.w],
            position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
            target: [this.orbit.target.x, this.orbit.target.y, this.orbit.target.z],
          },
        }))
      }

      const distance = Math.round(this.camera.position.distanceTo(this.orbit.target))
      if (distance !== this.lastReportedDistance) {
        this.lastReportedDistance = distance
        this.onCameraDistanceCallback?.(distance)
      }
    }
    loop()
  }

  resize(host: HTMLElement): void {
    const { width, height } = host.getBoundingClientRect()
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    // Width-in-pixels line materials compute in clip space and have to be told
    // the drawing-buffer size, or every edge in the scene draws at the width
    // that suited the previous viewport.
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    setEdgeResolution(buffer.x, buffer.y)
    this.composer?.setSize(width, height)
  }

  setBrightness(brightness: number): void {
    this.ambientLight.intensity = 0.3 * brightness
    this.keyLight.intensity = 1.8 * brightness
    this.fillLight.intensity = 0.3 * brightness
    this.rimLight.intensity = 0.2 * brightness
    this.viewLight.intensity = 0.45 * brightness
  }

  updateLightingForBounds(center: THREE.Vector3, radius: number): void {
    this.lastModelBounds = { center: center.clone(), radius }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = fogDensityForRadius(radius)
    }
    // Occlusion reach is a world-space distance, so it has to follow the part
    // the same way the fog and the light standoff do.
    this.ambientOcclusion?.updateGtaoMaterial({ radius: ambientOcclusionRadius(radius) })
    const standoff = radius * 3
    const keyDir = new THREE.Vector3(-100, -80, 180).normalize()
    const fillDir = new THREE.Vector3(120, 60, 40).normalize()
    const rimDir = new THREE.Vector3(-20, 140, -60).normalize()

    this.keyLight.position.copy(center).addScaledVector(keyDir, standoff)
    this.keyLight.target.position.copy(center)
    this.keyLight.target.updateMatrixWorld()

    this.fillLight.position.copy(center).addScaledVector(fillDir, standoff)
    this.fillLight.target.position.copy(center)
    this.fillLight.target.updateMatrixWorld()

    this.rimLight.position.copy(center).addScaledVector(rimDir, standoff)
    this.rimLight.target.position.copy(center)
    this.rimLight.target.updateMatrixWorld()
  }

  setCameraView(view: CameraView, customBounds?: { center: THREE.Vector3; radius: number }): void {
    if (view === 'fit') {
      this.frameModel(undefined, customBounds)
      return
    }
    const directions: Record<Exclude<CameraView, 'fit'>, THREE.Vector3> = {
      home: new THREE.Vector3(115, -135, 95).normalize(),
      top: new THREE.Vector3(0, 0, 1),
      bottom: new THREE.Vector3(0, 0, -1),
      front: new THREE.Vector3(0, -1, 0),
      back: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      left: new THREE.Vector3(-1, 0, 0),
      isometric: new THREE.Vector3(1, -1, 1).normalize(),
      dimetric: new THREE.Vector3(1, -2, 1).normalize(),
      trimetric: new THREE.Vector3(2, -3, 1.5).normalize(),
    }
    const up = (view === 'top' || view === 'bottom') ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
    syncOrbitControlsUp(this.orbit, this.camera, up)
    this.frameModel(directions[view], customBounds)
  }

  setCustomViewDirection(
    direction: [number, number, number] | THREE.Vector3,
    customUp?: [number, number, number] | THREE.Vector3,
    customBounds?: { center: THREE.Vector3; radius: number }
  ): void {
    const dirVec = Array.isArray(direction)
      ? new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
      : direction.clone().normalize()

    let upVec: THREE.Vector3
    if (customUp) {
      upVec = Array.isArray(customUp)
        ? new THREE.Vector3(customUp[0], customUp[1], customUp[2]).normalize()
        : customUp.clone().normalize()
    } else {
      upVec = Math.abs(dirVec.z) > 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
    }

    syncOrbitControlsUp(this.orbit, this.camera, upVec)
    this.frameModel(dirVec, customBounds)
  }

  rollCamera(degrees: number): void {
    const rad = THREE.MathUtils.degToRad(degrees)
    const viewDir = new THREE.Vector3().subVectors(this.orbit.target, this.camera.position).normalize()
    this.camera.up.applyAxisAngle(viewDir, rad)
    syncOrbitControlsUp(this.orbit, this.camera, this.camera.up)
    this.camera.lookAt(this.orbit.target)
    this.orbit.update()
  }

  reverseView(): void {
    const currentDirection = new THREE.Vector3().subVectors(this.camera.position, this.orbit.target)
    currentDirection.negate()
    this.camera.position.copy(this.orbit.target).add(currentDirection)
    this.camera.lookAt(this.orbit.target)
    this.orbit.update()
  }

  lookAtNormal(normal: [number, number, number], center?: [number, number, number]): void {
    const normVec = new THREE.Vector3(...normal).normalize()
    if (center) {
      this.orbit.target.set(...center)
    }
    const up = Math.abs(normVec.z) > 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
    syncOrbitControlsUp(this.orbit, this.camera, up)
    this.frameModel(normVec)
  }

  frameModel(preferredDirection?: THREE.Vector3, customBounds?: { center: THREE.Vector3; radius: number }): void {
    const { center, radius } = customBounds ?? this.lastModelBounds
    const currentDirection = preferredDirection ?? (
      this.camera.position.distanceTo(this.orbit.target) < 1e-4
        ? new THREE.Vector3(1, -1, 1).normalize()
        : this.camera.position.clone().sub(this.orbit.target).normalize()
    )
    const fit = fitCameraToRadius(radius, this.camera.fov, this.camera.aspect)
    this.orbit.target.copy(center)
    this.camera.position.copy(center).addScaledVector(currentDirection, fit.distance)
    this.camera.near = fit.near
    this.camera.far = fit.far
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(center)
    this.camera.updateMatrixWorld(true)
    this.orbit.update()
  }

  setSketchPlaneView(plane: SketchPlane, planeOffset: number, center: Vec2 = [0, 0], hostHeight = 400): void {
    const target = plane === 'XY'
      ? new THREE.Vector3(center[0], center[1], planeOffset)
      : plane === 'XZ'
        ? new THREE.Vector3(center[0], -planeOffset, center[1])
        : new THREE.Vector3(planeOffset, center[0], center[1])

    const direction = plane === 'XY'
      ? new THREE.Vector3(0, 0, 1)
      : plane === 'XZ'
        ? new THREE.Vector3(0, -1, 0)
        : new THREE.Vector3(1, 0, 0)

    const visibleHeight = Math.max(hostHeight, 1) / 4
    const distance = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
    this.orbit.target.copy(target)
    syncOrbitControlsUp(this.orbit, this.camera, plane === 'XY' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1))
    this.camera.position.copy(target).add(direction.multiplyScalar(distance))
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld(true)
    this.orbit.update()
  }

  dispose(): void {
    this.isDisposed = true
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
    }
    this.resizeObserver?.disconnect()
    this.orbit.dispose()
    this.composer?.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}
