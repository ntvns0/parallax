import type { PointerEvent as ReactPointerEvent } from 'react'
import { arcEndPoint, arcPointAt, arcStartPoint } from '../core/arc-geometry'
import type {
  DisplayUnits,
  LineEntity,
  SketchConstraint,
  SketchEntity,
  SketchFaceAttachment,
  Vec2,
} from '../core/model'
import type { DrawingPreviewState } from './sketch-drawing-preview'
import { formatLength, formatLengthInput } from '../core/units'
import type { LineRuler } from './entity-snap'
import { distance, type ActiveSnap } from './sketch-geometry-builders'
import { normalizeDegrees } from './sketch-readout'
import { arcPath, type ScreenMap } from './sketch-screen'
import type { ViewportSize } from './sketch-view'

/**
 * The layers of the sketch surface, back to front: the grid, the attached
 * face, the geometry and its labels, and whatever the active tool is previewing.
 *
 * Each layer only draws. Pointer handling stays with the editor, which passes
 * the handlers geometry needs to be grabbed by.
 */

export function SketchGrid({ screen, size, units }: { screen: ScreenMap; size: ViewportSize; units: DisplayUnits }) {
  const { scale } = screen
  const originX = screen.toX(0)
  const originY = screen.toY(0)
  const minorUnits = units === 'in-fractional'
    ? scale >= 2.4 ? 25.4 / 16 : scale >= 0.9 ? 25.4 / 4 : 25.4
    : units === 'in-decimal'
      ? scale >= 2.4 ? 2.54 : scale >= 0.9 ? 6.35 : 25.4
      : scale >= 2.4 ? 1 : scale >= 0.9 ? 5 : 10
  const majorUnits = units === 'mm' ? scale >= 2.4 ? 10 : scale >= 0.9 ? 25 : 50 : 25.4
  const minorSpacing = minorUnits * scale
  const majorSpacing = majorUnits * scale
  return <>
    <defs>
      <pattern id="minor-grid" x={originX} y={originY} width={minorSpacing} height={minorSpacing} patternUnits="userSpaceOnUse">
        <path d={`M ${minorSpacing} 0 L 0 0 0 ${minorSpacing}`} fill="none" stroke="#29312f" strokeWidth="0.45" />
      </pattern>
      <pattern id="major-grid" x={originX} y={originY} width={majorSpacing} height={majorSpacing} patternUnits="userSpaceOnUse">
        <path d={`M ${majorSpacing} 0 L 0 0 0 ${majorSpacing}`} fill="none" stroke="#3b4542" strokeWidth="0.75" />
      </pattern>
    </defs>
    {/* Light enough that the part underneath stays readable as context. */}
    <rect width={size.width} height={size.height} fill="#101413" fillOpacity={0.3} />
    <rect width={size.width} height={size.height} fill="url(#minor-grid)" />
    <rect width={size.width} height={size.height} fill="url(#major-grid)" />
    <line x1={0} y1={originY} x2={size.width} y2={originY} className="sketch-axis x-axis" />
    <line x1={originX} y1={0} x2={originX} y2={size.height} className="sketch-axis y-axis" />
    <circle cx={originX} cy={originY} r="3.5" className="sketch-origin" />
  </>
}

export function FaceReferenceGeometry({ attachment, screen: { toX, toY } }: { attachment: SketchFaceAttachment; screen: ScreenMap }) {
  const [cx, cy] = [toX(attachment.center[0]), toY(attachment.center[1])]
  return <g className="face-reference-geometry">
    {attachment.edges.map((edge, index) => <line key={index} x1={toX(edge.start[0])} y1={toY(edge.start[1])} x2={toX(edge.end[0])} y2={toY(edge.end[1])} />)}
    {attachment.edges.map((edge, index) => <circle key={`mid-${index}`} cx={toX((edge.start[0] + edge.end[0]) / 2)} cy={toY((edge.start[1] + edge.end[1]) / 2)} r="2.3" className="face-reference-midpoint" />)}
    <path d={`M ${cx - 7} ${cy} h 14 M ${cx} ${cy - 7} v 14`} className="face-reference-center" />
    <circle cx={cx} cy={cy} r="3.2" className="face-reference-center-ring" />
  </g>
}

export function SnapIndicator({ snap, screen: { toX, toY } }: { snap: ActiveSnap; screen: ScreenMap }) {
  return <g className={`snap-indicator ${snap.source} ${snap.kind}`}>
    <circle cx={toX(snap.point[0])} cy={toY(snap.point[1])} r="6" />
    <text x={toX(snap.point[0]) + 9} y={toY(snap.point[1]) - 9}>{snap.kind}</text>
  </g>
}

/** The sketch's geometry, with its dimension and direction labels. */
export function SketchEntityLayer({
  entities,
  constraints,
  screen,
  units,
  classNameFor,
  showEndpointHandles,
  onEntityPointerDown,
  onEndpointPointerDown,
}: {
  entities: SketchEntity[]
  constraints: SketchConstraint[]
  screen: ScreenMap
  units: DisplayUnits
  classNameFor: (entityId: string) => string
  showEndpointHandles: boolean
  onEntityPointerDown: (event: ReactPointerEvent<SVGGElement>, entityId: string) => void
  onEndpointPointerDown: (event: ReactPointerEvent<SVGCircleElement>, entity: LineEntity, pointRef: 'start' | 'end') => void
}) {
  const { toX, toY, scale } = screen
  const lineMidpoint = (constraint: SketchConstraint) => {
    const entity = entities.find((candidate) => candidate.id === constraint.entityIds[0])
    if (!entity || entity.type !== 'line') return null
    return { line: entity, midpoint: [(entity.start[0] + entity.end[0]) / 2, (entity.start[1] + entity.end[1]) / 2] as Vec2 }
  }
  return <>
    {entities.map((entity) => {
      const className = classNameFor(entity.id)
      const drag = (event: ReactPointerEvent<SVGGElement>) => onEntityPointerDown(event, entity.id)
      if (entity.type === 'line') {
        return (
          <g key={entity.id} data-entity-id={entity.id} className={className} onPointerDown={drag}>
            <line x1={toX(entity.start[0])} y1={toY(entity.start[1])} x2={toX(entity.end[0])} y2={toY(entity.end[1])} className="sketch-hit-area" />
            <line x1={toX(entity.start[0])} y1={toY(entity.start[1])} x2={toX(entity.end[0])} y2={toY(entity.end[1])} className="sketch-entity" />
            <circle cx={toX(entity.start[0])} cy={toY(entity.start[1])} r="2.6" className="sketch-point" />
            <circle cx={toX(entity.end[0])} cy={toY(entity.end[1])} r="2.6" className="sketch-point" />
            {showEndpointHandles && (['start', 'end'] as const).map((pointRef) => (
              <circle
                key={pointRef}
                cx={toX(entity[pointRef][0])}
                cy={toY(entity[pointRef][1])}
                r="8"
                className="sketch-point-hit-area"
                onPointerDown={(event) => onEndpointPointerDown(event, entity, pointRef)}
              />
            ))}
          </g>
        )
      }
      if (entity.type === 'arc') {
        const path = arcPath(entity, screen)
        const from = arcStartPoint(entity)
        const to = arcEndPoint(entity)
        const middle = arcPointAt(entity, 0.5)
        return (
          <g key={entity.id} data-entity-id={entity.id} className={className} onPointerDown={drag}>
            <path d={path} className="sketch-hit-area" />
            <path d={path} className="sketch-entity" />
            <circle cx={toX(from[0])} cy={toY(from[1])} r="2.6" className="sketch-point" />
            <circle cx={toX(to[0])} cy={toY(to[1])} r="2.6" className="sketch-point" />
            <text x={toX(middle[0])} y={toY(middle[1]) - 8} className="dimension-label">R {formatLength(entity.radius, units)}</text>
          </g>
        )
      }
      return (
        <g key={entity.id} data-entity-id={entity.id} className={className} onPointerDown={drag}>
          <circle cx={toX(entity.center[0])} cy={toY(entity.center[1])} r={entity.radius * scale} className="sketch-hit-area" />
          <circle cx={toX(entity.center[0])} cy={toY(entity.center[1])} r={entity.radius * scale} className="sketch-entity" />
          <circle cx={toX(entity.center[0])} cy={toY(entity.center[1])} r="2.6" className="sketch-point" />
          <text x={toX(entity.center[0])} y={toY(entity.center[1] + entity.radius) - 8} className="dimension-label">Ø {formatLength(entity.radius * 2, units)}</text>
        </g>
      )
    })}

    {constraints.filter((constraint) => constraint.type === 'horizontal' || constraint.type === 'vertical' || constraint.type === 'angle').map((constraint) => {
      const placed = lineMidpoint(constraint)
      if (!placed) return null
      const label = constraint.type === 'horizontal' ? 'H' : constraint.type === 'vertical' ? 'V' : `${normalizeDegrees(constraint.value ?? 0).toFixed(0)}°`
      return <text key={constraint.id} x={toX(placed.midpoint[0]) + 6} y={toY(placed.midpoint[1]) - 6} className="constraint-label">{label}</text>
    })}

    {constraints.filter((constraint) => constraint.type === 'distance').map((constraint) => {
      const placed = lineMidpoint(constraint)
      if (!placed) return null
      return <text key={constraint.id} x={toX(placed.midpoint[0])} y={toY(placed.midpoint[1]) - 15} className="dimension-label">
        {formatLength(constraint.value ?? distance(placed.line.start, placed.line.end), units)}
      </text>
    })}
  </>
}

/** What the active tool would add, drawn before it is added. */
export function DrawingPreview({ state, screen }: { state: DrawingPreviewState; screen: ScreenMap }) {
  const { toX, toY } = screen
  const { start, previewEnd, cursor, pendingArc, pendingThreePointArc, pendingTangentArc } = state
  const point = (at: Vec2, radius = '2.6') => <circle cx={toX(at[0])} cy={toY(at[1])} r={radius} className="sketch-point" />
  return <>
    {state.trimPreview && state.trimPreview.length > 1 && (
      <polyline
        className="trim-removal-preview"
        points={state.trimPreview.map((at) => `${toX(at[0])},${toY(at[1])}`).join(' ')}
      />
    )}
    {start && previewEnd && <ToolPreview tool={state.tool} start={start} end={previewEnd} screen={screen} />}
    {start && previewEnd && state.previewAngleSnap !== null && <g className="angle-inference-indicator">
      <line x1={toX(start[0])} y1={toY(start[1])} x2={toX(previewEnd[0])} y2={toY(previewEnd[1])} />
      <text x={toX(previewEnd[0]) + 10} y={toY(previewEnd[1]) + 14}>
        {normalizeDegrees(state.previewAngleSnap).toFixed(0)}°
      </text>
    </g>}
    {pendingArc && state.pendingArcPreview && <>
      <path d={arcPath(state.pendingArcPreview, screen)} className="sketch-preview" />
      {point(pendingArc.center)}
    </>}
    {pendingThreePointArc && <>
      {pendingThreePointArc.end
        ? state.threePointArcPreview && <path d={arcPath(state.threePointArcPreview, screen)} className="sketch-preview" />
        : cursor && <line x1={toX(pendingThreePointArc.start[0])} y1={toY(pendingThreePointArc.start[1])} x2={toX(cursor[0])} y2={toY(cursor[1])} className="sketch-preview" />}
      {point(pendingThreePointArc.start)}
      {pendingThreePointArc.end && point(pendingThreePointArc.end)}
    </>}
    {pendingTangentArc && <>
      {state.tangentArcPreview && <path d={arcPath(state.tangentArcPreview, screen)} className="sketch-preview" />}
      {point(pendingTangentArc.point, '3.4')}
    </>}
  </>
}

function ToolPreview({ tool, start, end, screen: { toX, toY, scale } }: { tool: string; start: Vec2; end: Vec2; screen: ScreenMap }) {
  if (tool === 'circle') {
    return <circle cx={toX(start[0])} cy={toY(start[1])} r={distance(start, end) * scale} className="sketch-preview" />
  }
  if (tool === 'arc') {
    // Only the centre and radius are settled at this point, so the preview is
    // the circle the arc will be cut from, with the radius being dragged.
    return <>
      <circle cx={toX(start[0])} cy={toY(start[1])} r={distance(start, end) * scale} className="sketch-preview" />
      <line x1={toX(start[0])} y1={toY(start[1])} x2={toX(end[0])} y2={toY(end[1])} className="sketch-preview" />
    </>
  }
  if (tool === 'rectangle') {
    const left = Math.min(start[0], end[0])
    const top = Math.max(start[1], end[1])
    return <rect x={toX(left)} y={toY(top)} width={Math.abs(end[0] - start[0]) * scale} height={Math.abs(end[1] - start[1]) * scale} className="sketch-preview" />
  }
  return <line x1={toX(start[0])} y1={toY(start[1])} x2={toX(end[0])} y2={toY(end[1])} className="sketch-preview" />
}

export function LineRulerOverlay({ ruler, units, screen: { toX, toY } }: { ruler: LineRuler; units: DisplayUnits; screen: ScreenMap }) {
  const start = [toX(ruler.start[0]), toY(ruler.start[1])] as Vec2
  const end = [toX(ruler.end[0]), toY(ruler.end[1])] as Vec2
  const screenLength = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (screenLength < 1e-6) return null
  const tangent: Vec2 = [(end[0] - start[0]) / screenLength, (end[1] - start[1]) / screenLength]
  const normal: Vec2 = [-tangent[1], tangent[0]]
  const offset = 11
  const screenPointAtDistance = (distanceFromDatum: number): Vec2 => {
    const fromStart = ruler.datum === 'start' ? distanceFromDatum : ruler.length - distanceFromDatum
    const ratio = ruler.length > 1e-9 ? fromStart / ruler.length : 0
    return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]
  }
  const datumPoint = screenPointAtDistance(0)
  const indicatedDistance = ruler.snap?.distance ?? ruler.projectedDistance
  const indicatedPoint = screenPointAtDistance(indicatedDistance)
  const readout = `${formatLength(indicatedDistance, units)} from ${ruler.datum}`
  const readoutWidth = Math.max(148, readout.length * 6.5)

  return <g className="line-ruler" data-line-id={ruler.lineId} data-datum={ruler.datum}>
    <line
      className="line-ruler-baseline"
      x1={start[0] + normal[0] * offset}
      y1={start[1] + normal[1] * offset}
      x2={end[0] + normal[0] * offset}
      y2={end[1] + normal[1] * offset}
    />
    {ruler.ticks.map((tick) => {
      const point = screenPointAtDistance(tick.distance)
      const active = tick.distance >= ruler.activeInterval[0] - 1e-8
        && tick.distance <= ruler.activeInterval[1] + 1e-8
      const inner = offset - (tick.major ? 4 : 1)
      const outer = offset + (tick.major ? 8 : 5)
      return <g
        key={`${tick.distance}-${tick.major ? 'major' : 'minor'}`}
        className={`line-ruler-tick ${tick.major ? 'major' : 'minor'}${active ? ' active' : ''}`}
        data-distance={tick.distance}
      >
        <line
          x1={point[0] + normal[0] * inner}
          y1={point[1] + normal[1] * inner}
          x2={point[0] + normal[0] * outer}
          y2={point[1] + normal[1] * outer}
        />
        {tick.major && <text
          x={point[0] + normal[0] * (offset + 19)}
          y={point[1] + normal[1] * (offset + 19)}
        >{formatLengthInput(tick.distance, units)}</text>}
      </g>
    })}
    <circle className="line-ruler-datum" cx={datumPoint[0]} cy={datumPoint[1]} r="3.2" />
    <g
      className="line-ruler-readout"
      transform={`translate(${indicatedPoint[0] + normal[0] * 47} ${indicatedPoint[1] + normal[1] * 47})`}
    >
      <rect x={-readoutWidth / 2} y="-18" width={readoutWidth} height="40" rx="5" />
      <text y="-3">{readout}</text>
      <text className="line-ruler-hint" y="13">TAB FLIPS DATUM</text>
    </g>
  </g>
}
