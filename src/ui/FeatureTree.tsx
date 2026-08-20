import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { useDocumentStore } from '../core/document-store'
import { collectFaceReferenceDiagnostics, useFeatureDiagnosticsStore } from '../core/diagnostics'
import type { FeatureKind } from '../core/model'
import { BoxFeatureIcon, CylinderFeatureIcon, ExtrudeFeatureIcon, FilletFeatureIcon, RevolveFeatureIcon, SketchFeatureIcon, SphereFeatureIcon } from './icons'
import { ParametersSection } from './ParametersPanel'

const featureIcons: Record<FeatureKind, typeof BoxFeatureIcon> = {
  box: BoxFeatureIcon,
  cylinder: CylinderFeatureIcon,
  sphere: SphereFeatureIcon,
  sketch: SketchFeatureIcon,
  extrude: ExtrudeFeatureIcon,
  revolve: RevolveFeatureIcon,
  fillet: FilletFeatureIcon,
}

export function FeaturePanel({ onMenu }: { onMenu: () => void }) {
  const features = useDocumentStore((state) => state.document.features)
  const selectedId = useDocumentStore((state) => state.selectedId)
  const unresolved = useFeatureDiagnosticsStore((state) => state.unresolved)
  const formulaDiagnostics = useDocumentStore((state) => state.formulaDiagnostics)
  const faceDiagnostics = collectFaceReferenceDiagnostics(features)
  return (
    <aside className="panel feature-panel">
      <div className="panel-header"><span>FEATURES</span><button aria-label="Open feature commands" onClick={onMenu}>•••</button></div>
      <div className="origin-row"><ChevronDown size={13} /><span className="origin-icon">⌖</span><span>Origin</span></div>
      <div className="origin-planes">
        <button onClick={() => useDocumentStore.getState().beginSketch(undefined, 'XY')}>XY Plane</button>
        <button onClick={() => useDocumentStore.getState().beginSketch(undefined, 'XZ')}>XZ Plane</button>
        <button onClick={() => useDocumentStore.getState().beginSketch(undefined, 'YZ')}>YZ Plane</button>
      </div>
      <div className="feature-list">
        {features.map((feature) => {
          const Icon = featureIcons[feature.kind]
          const warning = unresolved[feature.id] ?? faceDiagnostics[feature.id] ?? formulaDiagnostics[feature.id]
          return (
            <div
              key={feature.id}
              className={`feature-row${feature.id === selectedId ? ' selected' : ''}${warning ? ' unresolved' : ''}`}
            >
              <button className="feature-select" onClick={() => useDocumentStore.getState().select(feature.id)} onDoubleClick={() => { if (feature.kind === 'sketch') useDocumentStore.getState().beginSketch(feature.id) }}>
                <Icon /><span>{feature.name}</span>
                {warning && <span className="feature-warning" role="img" aria-label={`${feature.name} needs attention`} title={warning.message}>!</span>}
              </button>
              <button
                className="visibility-toggle"
                aria-label={`${feature.visible ? 'Hide' : 'Show'} ${feature.name}`}
                onClick={() => useDocumentStore.getState().toggleFeatureVisibility(feature.id)}
              >{feature.visible ? <Eye /> : <EyeOff />}</button>
            </div>
          )
        })}
      </div>
      <ParametersSection />
      <div className="timeline-label">PARAMETRIC HISTORY</div>
      <div className="timeline-rail">
        {features.map((feature, index) => <span key={feature.id} className={feature.id === selectedId ? 'active' : ''}>{index + 1}</span>)}
      </div>
    </aside>
  )
}
