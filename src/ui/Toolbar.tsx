import { type ReactNode } from 'react'
import {
  MousePointer2,
  PenTool,
  Ruler,
} from 'lucide-react'
import { useDocumentStore } from '../core/document-store'
import type { Feature, FeatureKind } from '../core/model'
import { getProfileRegions } from '../core/sketch'
import { defaultExtrudeDistance, materialDepthUnderSketch, FALLBACK_EXTRUDE_DISTANCE_MM } from '../core/extrude-defaults'
import { cachedExactMesh } from '../kernel/exact-kernel'
import { BoxFeatureIcon, CylinderFeatureIcon, ExtrudeFeatureIcon, FilletFeatureIcon, RevolveFeatureIcon, SketchFeatureIcon, SphereFeatureIcon } from './icons'

export function IconButton({ label, disabled, active, onClick, children }: {
  label: string
  disabled?: boolean
  active?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button className={`icon-button${active ? ' active' : ''}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function startingExtrudeDistance(sketch: Extract<Feature, { kind: 'sketch' }>): number {
  const faceNormalSign = sketch.parameters.faceNormalSign
  if (!faceNormalSign) return FALLBACK_EXTRUDE_DISTANCE_MM
  const features = useDocumentStore.getState().document.features
  const sketchIndex = features.findIndex((candidate) => candidate.id === sketch.id)
  const solid = [...features.slice(0, sketchIndex)].reverse()
    .find((candidate) => candidate.kind === 'extrude' || candidate.kind === 'fillet' || candidate.kind === 'revolve')
  if (!solid || solid.kind === 'revolve') return FALLBACK_EXTRUDE_DISTANCE_MM
  const mesh = cachedExactMesh(solid, features)
  if (!mesh) return FALLBACK_EXTRUDE_DISTANCE_MM
  return defaultExtrudeDistance(
    materialDepthUnderSketch(mesh.vertices, sketch.plane, sketch.parameters.planeOffset, faceNormalSign),
  )
}

export function ModelToolbar({
  onAdd,
  selectedFeature,
  onStartSketch,
  measureActive,
  onMeasureChange,
  onStartFillet,
}: {
  onAdd: (kind: FeatureKind) => void
  selectedFeature: Feature | null
  onStartSketch: () => void
  measureActive: boolean
  onMeasureChange: (active: boolean) => void
  onStartFillet: (feature: Extract<Feature, { kind: 'extrude' | 'fillet' }>) => void
}) {
  const canExtrude = selectedFeature?.kind === 'sketch' && getProfileRegions(selectedFeature).length > 0
  const canFillet = selectedFeature?.kind === 'extrude' || selectedFeature?.kind === 'fillet'
  return (
    <div className="model-toolbar">
      <IconButton label="Select" active={!measureActive} onClick={() => onMeasureChange(false)}><MousePointer2 /></IconButton>
      <IconButton label="Measure points and features" active={measureActive} onClick={() => onMeasureChange(!measureActive)}><Ruler /></IconButton>
      <div className="toolbar-divider" />
      <IconButton label="Add parametric box" onClick={() => onAdd('box')}><BoxFeatureIcon /></IconButton>
      <IconButton label="Add parametric cylinder" onClick={() => onAdd('cylinder')}><CylinderFeatureIcon /></IconButton>
      <IconButton label="Add parametric sphere" onClick={() => onAdd('sphere')}><SphereFeatureIcon /></IconButton>
      <div className="toolbar-divider" />
      <IconButton label="Create sketch" onClick={onStartSketch}><SketchFeatureIcon /></IconButton>
      <IconButton label={canExtrude ? 'Extrude selected sketch' : 'Select a closed sketch to extrude'} disabled={!canExtrude} onClick={() => {
        if (selectedFeature?.kind !== 'sketch') return
        useDocumentStore.getState().extrudeSketch(selectedFeature.id, startingExtrudeDistance(selectedFeature))
      }}><ExtrudeFeatureIcon /></IconButton>
      <IconButton label={canExtrude ? 'Revolve selected sketch' : 'Select a closed sketch to revolve'} disabled={!canExtrude} onClick={() => {
        if (selectedFeature?.kind === 'sketch') useDocumentStore.getState().revolveSketch(selectedFeature.id)
      }}><RevolveFeatureIcon /></IconButton>
      <IconButton label={canFillet ? 'Fillet selected edges' : 'Select an exact solid to fillet edges'} disabled={!canFillet} onClick={() => {
        if (selectedFeature?.kind === 'extrude' || selectedFeature?.kind === 'fillet') onStartFillet(selectedFeature)
      }}><FilletFeatureIcon /></IconButton>
    </div>
  )
}

export { ViewCube } from './ViewCube'

export function EmptyState({ onAdd, onStartSketch }: { onAdd: (kind: FeatureKind) => void; onStartSketch: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-symbol"><SketchFeatureIcon /></div>
      <p className="eyebrow">NEW PARAMETRIC PART</p>
      <h1>Start with design intent</h1>
      <p>Create a constrained sketch, or begin from a parametric primitive.</p>
      <div className="empty-actions">
        <button className="primary-action" onClick={onStartSketch}><PenTool /> New sketch</button>
        <button onClick={() => onAdd('box')}><BoxFeatureIcon /> Box</button>
        <button onClick={() => onAdd('cylinder')}><CylinderFeatureIcon /> Cylinder</button>
      </div>
    </div>
  )
}
