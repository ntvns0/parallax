import { useEffect, useLayoutEffect, useState, type RefObject, type WheelEvent as ReactWheelEvent } from 'react'
import type { SketchFeature, Vec2 } from '../core/model'
import { sketchBounds } from '../core/sketch'
import { useViewportStore } from '../viewport/viewport-store'
import {
  INITIAL_SCALE,
  frameBounds,
  viewCenter,
  zoomAtCenter,
  zoomAtScreenPoint,
  type SketchView,
  type ViewportSize,
} from './sketch-view'

const FIT_PADDING_PX = 110

/**
 * The sketch surface's pan and zoom, and its size on screen.
 *
 * The 3D camera follows this view through the viewport store, so the part
 * shows through the sketch exactly where it sits relative to the sketch plane.
 */
export function useSketchView(svgRef: RefObject<SVGSVGElement | null>, sketch: SketchFeature | undefined) {
  const [size, setSize] = useState<ViewportSize>({ width: 1, height: 1 })
  const [view, setView] = useState<SketchView>(() => ({
    scale: INITIAL_SCALE,
    panX: sketch?.attachment ? -sketch.attachment.center[0] * INITIAL_SCALE : 0,
    panY: sketch?.attachment ? sketch.attachment.center[1] * INITIAL_SCALE : 0,
  }))

  useEffect(() => {
    useViewportStore.getState().setSketchFrame({ center: viewCenter(view), pixelsPerMm: view.scale })
  }, [view])
  useEffect(() => () => useViewportStore.getState().setSketchFrame(null), [])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(svg)
    const bounds = svg.getBoundingClientRect()
    setSize({ width: bounds.width, height: bounds.height })
    return () => observer.disconnect()
  }, [svgRef])

  function onWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const offset: Vec2 = [event.clientX - bounds.left, event.clientY - bounds.top]
    const factor = Math.exp(-event.deltaY * 0.0015)
    setView((current) => zoomAtScreenPoint(current, size, offset, factor))
  }

  const zoom = (factor: number) => setView((current) => zoomAtCenter(current, factor))
  const reset = () => setView({ scale: INITIAL_SCALE, panX: 0, panY: 0 })

  function fit() {
    if (!sketch) return
    const bounds = sketchBounds(sketch.entities)
    // With nothing drawn yet, frame the face being sketched on so the user has
    // some context; with no face either there is nothing to frame.
    if (!sketch.entities.length || bounds.width < 1e-9 || bounds.height < 1e-9) {
      if (sketch.attachment) setView(frameBounds(sketch.attachment.bounds.min, sketch.attachment.bounds.max, size, FIT_PADDING_PX))
      else reset()
      return
    }
    setView(frameBounds(bounds.min, bounds.max, size, FIT_PADDING_PX))
  }

  return { view, setView, size, onWheel, zoom, reset, fit }
}
