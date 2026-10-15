import { describe, expect, it } from 'vitest'
import { SKETCH_TOOLS, toolForKey } from './sketch-tools'

describe('sketch tool shortcuts', () => {
  it('maps each shortcut to its tool, in either case', () => {
    expect(toolForKey('l')).toBe('line')
    expect(toolForKey('L')).toBe('line')
    expect(toolForKey('x')).toBe('trim')
  })

  it('ignores keys that are not shortcuts, including named keys', () => {
    expect(toolForKey('q')).toBeNull()
    expect(toolForKey('Delete')).toBeNull()
    expect(toolForKey('Escape')).toBeNull()
  })

  it('gives every tool its own key', () => {
    const keys = SKETCH_TOOLS.map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
