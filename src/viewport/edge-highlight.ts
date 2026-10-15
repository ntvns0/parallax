import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { EdgeSegment } from './edge-references'

/**
 * A thick line drawn over the edges the pointer is about: the edge a
 * measurement would snap to, or the edges a fillet will round. Drawn over the
 * part, so a highlighted edge shows even where the part hides it.
 */
export class EdgeHighlight {
  private geometry = new LineSegmentsGeometry()
  private readonly material = new LineMaterial({ color: '#8ff0cc', transparent: true, opacity: 0.9, depthTest: false, linewidth: 5 })
  readonly object = new LineSegments2(this.geometry, this.material)

  constructor() {
    this.object.visible = false
  }

  show(segments: EdgeSegment[], color: string) {
    this.object.visible = segments.length > 0
    if (!segments.length) return
    this.geometry.dispose()
    this.geometry = new LineSegmentsGeometry()
    this.geometry.setPositions(segments.flatMap((segment) => [...segment.start, ...segment.end]))
    this.geometry.computeBoundingSphere()
    this.object.geometry = this.geometry
    this.material.color.set(color)
  }

  hide() {
    this.object.visible = false
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
