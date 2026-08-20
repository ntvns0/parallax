import type { SketchAnchor, SketchConstraint, SketchEntity } from '../core/model'

export type ConstraintRequest = {
  id: number
  entities: SketchEntity[]
  constraints: SketchConstraint[]
  anchor?: SketchAnchor
}

export type ConstraintResponse =
  | {
      id: number
      ok: true
      entities: SketchEntity[]
      redundant: string[]
      conflicting: string[]
      /** Constraints with no PlaneGCS equivalent for the geometry they name. */
      unsupported: string[]
      degreesOfFreedom: number
    }
  | { id: number; ok: false; error: string }
