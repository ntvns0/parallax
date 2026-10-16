import { describe, expect, it } from 'vitest'
import { bodiesBefore, bodyMembership, bodyToChange, listBodies, type BodyMember } from './bodies'

const sketch = (id: string): BodyMember => ({ id, kind: 'sketch' })
const extrude = (id: string, operation: BodyMember['operation'], bodyId?: string): BodyMember => ({ id, kind: 'extrude', operation, ...(bodyId ? { bodyId } : {}) })
const fillet = (id: string, bodyId?: string): BodyMember => ({ id, kind: 'fillet', ...(bodyId ? { bodyId } : {}) })

describe('bodies', () => {
  it('reads a single-body history as one body, as it always has', () => {
    const features = [sketch('s1'), extrude('box', 'newBody'), sketch('s2'), extrude('pocket', 'cut'), fillet('round')]
    expect([...bodyMembership(features)]).toEqual([['box', 'box'], ['pocket', 'box'], ['round', 'box']])
  })

  it('starts a body at each new-body sweep, and changes the latest by default', () => {
    const features = [extrude('box', 'newBody'), extrude('lid', 'newBody'), extrude('vent', 'cut')]
    expect(bodyMembership(features).get('vent')).toBe('lid')
  })

  it('changes an earlier body when told to, and carries on in it', () => {
    const features = [extrude('box', 'newBody'), extrude('lid', 'newBody'), extrude('port', 'cut', 'box'), fillet('round')]
    const membership = bodyMembership(features)
    expect(membership.get('port')).toBe('box')
    expect(membership.get('round')).toBe('box')
  })

  it('ignores a body that does not exist yet or any more', () => {
    const features = [extrude('box', 'newBody'), extrude('cut', 'cut', 'lid'), extrude('lid', 'newBody')]
    expect(bodyMembership(features).get('cut')).toBe('box')
  })

  it('lets a history open on something that is not a new body', () => {
    expect(bodyMembership([fillet('round'), extrude('boss', 'add')]).get('boss')).toBe('round')
  })

  it('lists the bodies with their features, and those before a feature', () => {
    const features = [extrude('box', 'newBody'), extrude('lid', 'newBody'), extrude('port', 'cut', 'box')]
    expect(listBodies(features)).toEqual([
      { id: 'box', name: 'Body 1', featureIds: ['box', 'port'] },
      { id: 'lid', name: 'Body 2', featureIds: ['lid'] },
    ])
    expect(bodiesBefore(features, 'lid').map((body) => body.id)).toEqual(['box'])
  })

  it('names the body a new feature changes only once there is a choice', () => {
    expect(bodyToChange([extrude('box', 'newBody'), fillet('round')], 'round')).toBeUndefined()
    const features = [extrude('box', 'newBody'), fillet('round'), extrude('lid', 'newBody')]
    expect(bodyToChange(features, 'round')).toBe('box')
    expect(bodyToChange(features, undefined)).toBeUndefined()
  })
})
