import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  ArrowLeftRight,
  Compass,
  Home,
  Maximize,
  RotateCcw,
  RotateCw,
} from 'lucide-react'
import { useViewportStore } from '../viewport/viewport-store'

interface ViewZone {
  label: string
  direction: [number, number, number]
  up?: [number, number, number]
  view?: string
}

function createFaceTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  // Subtle metallic dark background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 256, 256)
  bgGrad.addColorStop(0, '#1c2321')
  bgGrad.addColorStop(1, '#29322e')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, 256, 256)

  // Outer border stroke
  ctx.strokeStyle = '#43544c'
  ctx.lineWidth = 10
  ctx.strokeRect(5, 5, 246, 246)

  // Inner CAD corner ticks
  ctx.strokeStyle = '#69ddb2'
  ctx.lineWidth = 4
  const tick = 24
  // Top-left tick
  ctx.beginPath()
  ctx.moveTo(14, 14 + tick)
  ctx.lineTo(14, 14)
  ctx.lineTo(14 + tick, 14)
  ctx.stroke()
  // Top-right tick
  ctx.beginPath()
  ctx.moveTo(242 - tick, 14)
  ctx.lineTo(242, 14)
  ctx.lineTo(242, 14 + tick)
  ctx.stroke()
  // Bottom-left tick
  ctx.beginPath()
  ctx.moveTo(14, 242 - tick)
  ctx.lineTo(14, 242)
  ctx.lineTo(14 + tick, 242)
  ctx.stroke()
  // Bottom-right tick
  ctx.beginPath()
  ctx.moveTo(242 - tick, 242)
  ctx.lineTo(242, 242)
  ctx.lineTo(242, 242 - tick)
  ctx.stroke()

  // Label text
  ctx.fillStyle = '#e4ece8'
  ctx.font = 'bold 44px "DM Mono", monospace, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = color
    ctx.font = 'bold 42px "DM Mono", monospace, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 32, 32)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.35, 0.35, 1)
  return sprite
}

export function ViewCube() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const projectionMode = useViewportStore((state) => state.projectionMode)
  const setProjectionMode = useViewportStore((state) => state.setProjectionMode)

  const setView = (view: string) => {
    window.dispatchEvent(new CustomEvent('parallax:set-view', { detail: view }))
  }

  const rollView = (deg: number) => {
    window.dispatchEvent(new CustomEvent('parallax:roll-view', { detail: deg }))
  }

  const reverseView = () => {
    window.dispatchEvent(new CustomEvent('parallax:reverse-view'))
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const width = 135
    const height = 135

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(0, 0, 5.2)
    camera.lookAt(0, 0, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace
    } catch {
      // Return gracefully in headless testing environments without WebGL support
      return
    }

    // Ambient and directional lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 1.3)
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.6)
    keyLight.position.set(4, 6, 8)
    const fillLight = new THREE.DirectionalLight('#69ddb2', 0.5)
    fillLight.position.set(-4, -4, -2)
    scene.add(ambientLight, keyLight, fillLight)

    const cubeGroup = new THREE.Group()
    scene.add(cubeGroup)

    // Base materials
    const defaultEdgeMaterial = new THREE.MeshStandardMaterial({
      color: '#28312d',
      roughness: 0.45,
      metalness: 0.3,
    })
    const defaultCornerMaterial = new THREE.MeshStandardMaterial({
      color: '#323c38',
      roughness: 0.4,
      metalness: 0.4,
    })
    const hoverMaterial = new THREE.MeshStandardMaterial({
      color: '#336151',
      emissive: '#255745',
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.5,
    })

    // 1. Create the 6 main faces
    const faces: Array<{
      label: string
      view: string
      dir: [number, number, number]
      up: [number, number, number]
      pos: [number, number, number]
      rot: [number, number, number]
    }> = [
      { label: 'TOP', view: 'top', dir: [0, 0, 1], up: [0, 1, 0], pos: [0, 0, 0.92], rot: [0, 0, 0] },
      { label: 'BOTTOM', view: 'bottom', dir: [0, 0, -1], up: [0, 1, 0], pos: [0, 0, -0.92], rot: [Math.PI, 0, 0] },
      { label: 'FRONT', view: 'front', dir: [0, -1, 0], up: [0, 0, 1], pos: [0, -0.92, 0], rot: [Math.PI / 2, 0, 0] },
      { label: 'BACK', view: 'back', dir: [0, 1, 0], up: [0, 0, 1], pos: [0, 0.92, 0], rot: [-Math.PI / 2, 0, 0] },
      { label: 'RIGHT', view: 'right', dir: [1, 0, 0], up: [0, 0, 1], pos: [0.92, 0, 0], rot: [0, Math.PI / 2, 0] },
      { label: 'LEFT', view: 'left', dir: [-1, 0, 0], up: [0, 0, 1], pos: [-0.92, 0, 0], rot: [0, -Math.PI / 2, 0] },
    ]

    const faceGeometry = new THREE.BoxGeometry(1.44, 1.44, 0.06)

    faces.forEach((f) => {
      const tex = createFaceTexture(f.label)
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.35,
        metalness: 0.2,
      })
      const mesh = new THREE.Mesh(faceGeometry, mat)
      mesh.position.set(...f.pos)
      mesh.rotation.set(...f.rot)
      mesh.userData = {
        label: `${f.label} VIEW`,
        view: f.view,
        direction: f.dir,
        up: f.up,
        type: 'face',
        baseMaterial: mat,
      } as unknown as ViewZone & { type: string; baseMaterial: THREE.Material }
      cubeGroup.add(mesh)
    })

    // 2. Create 12 edge chamfers
    const edges: Array<{
      label: string
      dir: [number, number, number]
      pos: [number, number, number]
      size: [number, number, number]
      rot?: [number, number, number]
    }> = [
      { label: 'Top-Front Edge', dir: [0, -1, 1], pos: [0, -0.86, 0.86], size: [1.38, 0.18, 0.18], rot: [Math.PI / 4, 0, 0] },
      { label: 'Top-Back Edge', dir: [0, 1, 1], pos: [0, 0.86, 0.86], size: [1.38, 0.18, 0.18], rot: [-Math.PI / 4, 0, 0] },
      { label: 'Top-Right Edge', dir: [1, 0, 1], pos: [0.86, 0, 0.86], size: [0.18, 1.38, 0.18], rot: [0, Math.PI / 4, 0] },
      { label: 'Top-Left Edge', dir: [-1, 0, 1], pos: [-0.86, 0, 0.86], size: [0.18, 1.38, 0.18], rot: [0, -Math.PI / 4, 0] },
      { label: 'Bottom-Front Edge', dir: [0, -1, -1], pos: [0, -0.86, -0.86], size: [1.38, 0.18, 0.18], rot: [-Math.PI / 4, 0, 0] },
      { label: 'Bottom-Back Edge', dir: [0, 1, -1], pos: [0, 0.86, -0.86], size: [1.38, 0.18, 0.18], rot: [Math.PI / 4, 0, 0] },
      { label: 'Bottom-Right Edge', dir: [1, 0, -1], pos: [0.86, 0, -0.86], size: [0.18, 1.38, 0.18], rot: [0, -Math.PI / 4, 0] },
      { label: 'Bottom-Left Edge', dir: [-1, 0, -1], pos: [-0.86, 0, -0.86], size: [0.18, 1.38, 0.18], rot: [0, Math.PI / 4, 0] },
      { label: 'Front-Right Edge', dir: [1, -1, 0], pos: [0.86, -0.86, 0], size: [0.18, 0.18, 1.38], rot: [0, 0, Math.PI / 4] },
      { label: 'Front-Left Edge', dir: [-1, -1, 0], pos: [-0.86, -0.86, 0], size: [0.18, 0.18, 1.38], rot: [0, 0, -Math.PI / 4] },
      { label: 'Back-Right Edge', dir: [1, 1, 0], pos: [0.86, 0.86, 0], size: [0.18, 0.18, 1.38], rot: [0, 0, -Math.PI / 4] },
      { label: 'Back-Left Edge', dir: [-1, 1, 0], pos: [-0.86, 0.86, 0], size: [0.18, 0.18, 1.38], rot: [0, 0, Math.PI / 4] },
    ]

    edges.forEach((e) => {
      const geo = new THREE.BoxGeometry(...e.size)
      const mesh = new THREE.Mesh(geo, defaultEdgeMaterial)
      mesh.position.set(...e.pos)
      if (e.rot) mesh.rotation.set(...e.rot)
      mesh.userData = {
        label: e.label,
        direction: e.dir,
        type: 'edge',
        baseMaterial: defaultEdgeMaterial,
      }
      cubeGroup.add(mesh)
    })

    // 3. Create 8 corner chamfers
    const corners: Array<{
      label: string
      view?: string
      dir: [number, number, number]
      pos: [number, number, number]
    }> = [
      { label: 'Top-Front-Right Corner', view: 'isometric', dir: [1, -1, 1], pos: [0.86, -0.86, 0.86] },
      { label: 'Top-Front-Left Corner', dir: [-1, -1, 1], pos: [-0.86, -0.86, 0.86] },
      { label: 'Top-Back-Right Corner', dir: [1, 1, 1], pos: [0.86, 0.86, 0.86] },
      { label: 'Top-Back-Left Corner', dir: [-1, 1, 1], pos: [-0.86, 0.86, 0.86] },
      { label: 'Bottom-Front-Right Corner', dir: [1, -1, -1], pos: [0.86, -0.86, -0.86] },
      { label: 'Bottom-Front-Left Corner', dir: [-1, -1, -1], pos: [-0.86, -0.86, -0.86] },
      { label: 'Bottom-Back-Right Corner', dir: [1, 1, -1], pos: [0.86, 0.86, -0.86] },
      { label: 'Bottom-Back-Left Corner', dir: [-1, 1, -1], pos: [-0.86, 0.86, -0.86] },
    ]

    const cornerGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2)
    corners.forEach((c) => {
      const mesh = new THREE.Mesh(cornerGeo, defaultCornerMaterial)
      mesh.position.set(...c.pos)
      mesh.userData = {
        label: c.label,
        view: c.view,
        direction: c.dir,
        type: 'corner',
        baseMaterial: defaultCornerMaterial,
      }
      cubeGroup.add(mesh)
    })

    // 4. Create 3D Axis Triad (Red X, Green Y, Blue Z)
    const triadGroup = new THREE.Group()
    const axisRadius = 0.03
    const axisLength = 1.3

    // X Axis (Red)
    const xGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 12)
    const xMat = new THREE.MeshStandardMaterial({ color: '#ef5350', roughness: 0.3, metalness: 0.4 })
    const xMesh = new THREE.Mesh(xGeo, xMat)
    xMesh.rotation.z = -Math.PI / 2
    xMesh.position.x = axisLength / 2
    const xConeGeo = new THREE.ConeGeometry(0.08, 0.2, 12)
    const xCone = new THREE.Mesh(xConeGeo, xMat)
    xCone.rotation.z = -Math.PI / 2
    xCone.position.x = axisLength + 0.1
    const xSprite = createTextSprite('X', '#ff6b6b')
    xSprite.position.set(axisLength + 0.32, 0, 0)
    triadGroup.add(xMesh, xCone, xSprite)

    // Y Axis (Green)
    const yGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 12)
    const yMat = new THREE.MeshStandardMaterial({ color: '#4caf50', roughness: 0.3, metalness: 0.4 })
    const yMesh = new THREE.Mesh(yGeo, yMat)
    yMesh.position.y = axisLength / 2
    const yConeGeo = new THREE.ConeGeometry(0.08, 0.2, 12)
    const yCone = new THREE.Mesh(yConeGeo, yMat)
    yCone.position.y = axisLength + 0.1
    const ySprite = createTextSprite('Y', '#51cf66')
    ySprite.position.set(0, axisLength + 0.32, 0)
    triadGroup.add(yMesh, yCone, ySprite)

    // Z Axis (Blue)
    const zGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 12)
    const zMat = new THREE.MeshStandardMaterial({ color: '#42a5f5', roughness: 0.3, metalness: 0.4 })
    const zMesh = new THREE.Mesh(zGeo, zMat)
    zMesh.rotation.x = Math.PI / 2
    zMesh.position.z = axisLength / 2
    const zConeGeo = new THREE.ConeGeometry(0.08, 0.2, 12)
    const zCone = new THREE.Mesh(zConeGeo, zMat)
    zCone.rotation.x = Math.PI / 2
    zCone.position.z = axisLength + 0.1
    const zSprite = createTextSprite('Z', '#4dabf7')
    zSprite.position.set(0, 0, axisLength + 0.32)
    triadGroup.add(zMesh, zCone, zSprite)

    // Move triad to lower left corner inside group
    triadGroup.position.set(-1.25, -1.25, -1.15)
    triadGroup.scale.set(0.65, 0.65, 0.65)
    cubeGroup.add(triadGroup)

    // 5. Compass Azimuth Base Ring
    const ringGeo = new THREE.RingGeometry(1.68, 1.76, 48)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#3d4d46', side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
    const ringMesh = new THREE.Mesh(ringGeo, ringMat)
    ringMesh.position.z = -1.2
    cubeGroup.add(ringMesh)

    // Initial render
    renderer.render(scene, camera)

    // Listen to camera changes from main viewport controller
    function onCameraChange(event: Event) {
      const detail = (event as CustomEvent<{ quaternion: [number, number, number, number] }>).detail
      if (detail?.quaternion) {
        const q = new THREE.Quaternion(...detail.quaternion)
        cubeGroup.quaternion.copy(q.invert())
        renderer.render(scene, camera)
      }
    }
    window.addEventListener('parallax:camera-change', onCameraChange)

    // Raycaster for hover & click detection
    const cv = canvas
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    let hoveredMesh: THREE.Mesh | null = null

    function getIntersections(e: MouseEvent) {
      const rect = cv.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      return raycaster.intersectObjects(cubeGroup.children, true)
    }

    function onPointerMove(e: MouseEvent) {
      const hits = getIntersections(e)
      const targetHit = hits.find((h) => h.object.userData && h.object.userData.label)

      if (targetHit) {
        const mesh = targetHit.object as THREE.Mesh
        if (hoveredMesh !== mesh) {
          if (hoveredMesh) {
            const baseMat = hoveredMesh.userData.baseMaterial as THREE.Material
            if (baseMat) hoveredMesh.material = baseMat
          }
          hoveredMesh = mesh
          hoveredMesh.material = hoverMaterial
          setHoverLabel(mesh.userData.label as string)
          cv.style.cursor = 'pointer'
          renderer.render(scene, camera)
        }
      } else if (hoveredMesh) {
        const baseMat = hoveredMesh.userData.baseMaterial as THREE.Material
        if (baseMat) hoveredMesh.material = baseMat
        hoveredMesh = null
        setHoverLabel(null)
        cv.style.cursor = 'default'
        renderer.render(scene, camera)
      }
    }

    let downPos = { x: 0, y: 0 }
    function onPointerDown(e: MouseEvent) {
      downPos = { x: e.clientX, y: e.clientY }
    }

    function onPointerUp(e: MouseEvent) {
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
      if (dist > 6) return // User dragged camera

      const hits = getIntersections(e)
      const targetHit = hits.find((h) => h.object.userData && (h.object.userData.view || h.object.userData.direction))

      if (targetHit) {
        const data = targetHit.object.userData as ViewZone
        if (data.view) {
          window.dispatchEvent(new CustomEvent('parallax:set-view', { detail: data.view }))
        } else if (data.direction) {
          window.dispatchEvent(new CustomEvent('parallax:set-view-direction', {
            detail: { direction: data.direction, up: data.up },
          }))
        }
      }
    }

    function onPointerLeave() {
      if (hoveredMesh) {
        const baseMat = hoveredMesh.userData.baseMaterial as THREE.Material
        if (baseMat) hoveredMesh.material = baseMat
        hoveredMesh = null
        setHoverLabel(null)
        cv.style.cursor = 'default'
        renderer.render(scene, camera)
      }
    }

    cv.addEventListener('mousemove', onPointerMove)
    cv.addEventListener('mousedown', onPointerDown)
    cv.addEventListener('mouseup', onPointerUp)
    cv.addEventListener('mouseleave', onPointerLeave)

    return () => {
      window.removeEventListener('parallax:camera-change', onCameraChange)
      cv.removeEventListener('mousemove', onPointerMove)
      cv.removeEventListener('mousedown', onPointerDown)
      cv.removeEventListener('mouseup', onPointerUp)
      cv.removeEventListener('mouseleave', onPointerLeave)
      renderer.dispose()
    }
  }, [])

  return (
    <div className="view-controls">
      <div className="view-cube-container" title="Interactive 3D View Cube (Click face, edge, or corner)">
        <canvas ref={canvasRef} className="view-cube-canvas" width={135} height={135} />
        {hoverLabel && <div className="view-cube-tooltip">{hoverLabel}</div>}
      </div>

      <div className="view-cube-quick-actions">
        <button title="Home view (Isometric Z-up)" onClick={() => setView('isometric')}>
          <Home size={13} />
        </button>
        <button title="Rotate view 90° CCW" onClick={() => rollView(-90)}>
          <RotateCcw size={13} />
        </button>
        <button title="Rotate view 90° CW" onClick={() => rollView(90)}>
          <RotateCw size={13} />
        </button>
        <button title="Flip view 180°" onClick={reverseView}>
          <ArrowLeftRight size={13} />
        </button>
        <button title="Fit model to screen (F)" onClick={() => setView('fit')}>
          <Maximize size={13} />
        </button>
        <button title="Orientation menu" className={menuOpen ? 'active' : ''} onClick={() => setMenuOpen(!menuOpen)}>
          <Compass size={13} />
        </button>
      </div>

      {menuOpen && (
        <div className="orientation-menu" role="menu">
          <div className="menu-heading">STANDARD VIEWS</div>
          <div className="menu-grid">
            <button onClick={() => { setView('isometric'); setMenuOpen(false) }}>Isometric</button>
            <button onClick={() => { setView('top'); setMenuOpen(false) }}>Top (XY)</button>
            <button onClick={() => { setView('bottom'); setMenuOpen(false) }}>Bottom</button>
            <button onClick={() => { setView('front'); setMenuOpen(false) }}>Front (XZ)</button>
            <button onClick={() => { setView('back'); setMenuOpen(false) }}>Back</button>
            <button onClick={() => { setView('right'); setMenuOpen(false) }}>Right (YZ)</button>
            <button onClick={() => { setView('left'); setMenuOpen(false) }}>Left</button>
            <button onClick={() => { setView('dimetric'); setMenuOpen(false) }}>Dimetric</button>
            <button onClick={() => { setView('trimetric'); setMenuOpen(false) }}>Trimetric</button>
          </div>

          <div className="menu-heading">PROJECTION</div>
          <div className="projection-toggle">
            <button className={projectionMode === 'perspective' ? 'active' : ''} onClick={() => setProjectionMode('perspective')}>Perspective</button>
            <button className={projectionMode === 'orthographic' ? 'active' : ''} onClick={() => setProjectionMode('orthographic')}>Orthographic</button>
          </div>
        </div>
      )}
    </div>
  )
}
