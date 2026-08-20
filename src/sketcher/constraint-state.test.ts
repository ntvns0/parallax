import { describe, expect, it } from 'vitest'
import { sketchConstraintState } from './constraint-state'

const clean = {
  status: 'solved' as const,
  degreesOfFreedom: 3,
  conflicting: [],
  redundant: [],
  unsupported: [],
}

describe('sketchConstraintState', () => {
  it('distinguishes under- and fully-constrained solves', () => {
    expect(sketchConstraintState(clean)).toBe('under-constrained')
    expect(sketchConstraintState({ ...clean, degreesOfFreedom: 0 })).toBe('fully-constrained')
  })

  it.each(['conflicting', 'redundant', 'unsupported'] as const)(
    'marks %s constraints as an over-constrained warning state',
    (kind) => {
      expect(sketchConstraintState({ ...clean, [kind]: ['constraint-1'] })).toBe('over-constrained')
    },
  )

  it('keeps pending and failed solver results neutral when no constraint is identified', () => {
    expect(sketchConstraintState({ ...clean, status: 'loading' })).toBe('neutral')
    expect(sketchConstraintState({ ...clean, status: 'error', degreesOfFreedom: null })).toBe('neutral')
  })
})
