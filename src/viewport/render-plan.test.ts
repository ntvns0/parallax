import { describe, expect, it } from 'vitest'
import { planSolidRender, type RenderPlanFeature } from './render-plan'

const sketch = (id: string): RenderPlanFeature => ({ id, kind: 'sketch', visible: true })
const extrude = (id: string, operation: 'newBody' | 'add' | 'cut'): RenderPlanFeature =>
  ({ id, kind: 'extrude', visible: true, operation })
const fillet = (id: string): RenderPlanFeature => ({ id, kind: 'fillet', visible: true })
const revolve = (id: string, operation: 'newBody' | 'add' | 'cut'): RenderPlanFeature =>
  ({ id, kind: 'revolve', visible: true, operation })

describe('planSolidRender', () => {
  it('draws a lone body', () => {
    const plan = planSolidRender([sketch('s1'), extrude('e1', 'newBody')])
    expect([...plan.rendered]).toEqual(['e1'])
    expect(plan.supersedes.get('e1')).toEqual([])
  })

  it('skips a fallback whose next stage is a boolean extrude', () => {
    // The cut previews the pre-cut state itself, so drawing e1 as well is waste.
    const plan = planSolidRender([extrude('e1', 'newBody'), extrude('e2', 'cut')])
    expect([...plan.rendered]).toEqual(['e2'])
  })

  it('keeps a fallback alive while a fillet evaluates', () => {
    const plan = planSolidRender([extrude('e1', 'newBody'), fillet('f1')])
    expect([...plan.rendered]).toEqual(['e1', 'f1'])
    expect(plan.supersedes.get('f1')).toEqual(['e1'])
  })

  it('never lets a new body delete the body before it', () => {
    const plan = planSolidRender([extrude('e1', 'newBody'), fillet('f1'), extrude('e2', 'newBody')])
    expect(plan.supersedes.get('e2')).toEqual([])
    // Both bodies stay on screen; they are separate objects.
    expect([...plan.rendered]).toEqual(['e1', 'f1', 'e2'])
  })

  it('a cut after fillets clears the filleted fallback that would hide it', () => {
    // The reported bug: cutting into the top face appeared to do nothing.
    // f4 is the last drawn fallback (f5 is skipped because e4 follows it), and
    // nothing removed f4 once e4 returned — so the uncut solid sat exactly on
    // top of the cut one and hid the pocket.
    const plan = planSolidRender([
      sketch('s1'), extrude('e1', 'newBody'),
      sketch('s2'), extrude('e2', 'cut'),
      fillet('f1'), fillet('f2'),
      sketch('s3'), extrude('e3', 'cut'),
      fillet('f3'), fillet('f4'), fillet('f5'),
      sketch('s4'), extrude('e4', 'cut'),
    ])
    expect([...plan.rendered]).toEqual(['e4'])
    expect(plan.supersedes.get('e4')).toEqual([])
  })

  it('ignores hidden features entirely', () => {
    const plan = planSolidRender([
      extrude('e1', 'newBody'),
      { id: 'f1', kind: 'fillet', visible: false },
      fillet('f2'),
    ])
    expect(plan.rendered.has('f1')).toBe(false)
    expect(plan.supersedes.get('f2')).toEqual(['e1'])
  })

  it('keeps two independent bodies apart', () => {
    const plan = planSolidRender([
      extrude('a1', 'newBody'), fillet('a2'),
      extrude('b1', 'newBody'), fillet('b2'),
    ])
    expect(plan.supersedes.get('a2')).toEqual(['a1'])
    expect(plan.supersedes.get('b2')).toEqual(['b1'])
  })

  it('draws a lone revolve body', () => {
    const plan = planSolidRender([sketch('s1'), revolve('r1', 'newBody')])
    expect([...plan.rendered]).toEqual(['r1'])
    expect(plan.supersedes.get('r1')).toEqual([])
  })

  it('keeps a fallback alive while a fillet on a revolve evaluates', () => {
    const plan = planSolidRender([revolve('r1', 'newBody'), fillet('f1')])
    expect([...plan.rendered]).toEqual(['r1', 'f1'])
    expect(plan.supersedes.get('f1')).toEqual(['r1'])
  })

  it('never lets a new revolve body delete the body before it', () => {
    // Revolve was absent from `startsBody` and so was folded into the preceding
    // body, whose finished solid it then superseded and erased.
    const plan = planSolidRender([extrude('e1', 'newBody'), revolve('r1', 'newBody')])
    expect(plan.supersedes.get('r1')).toEqual([])
    expect([...plan.rendered]).toEqual(['e1', 'r1'])
  })

  it('treats a revolve cut as a stage of the body it cuts', () => {
    // Like the extrude-cut case above, the cut previews the pre-cut state
    // itself, so e1 is never drawn and there is nothing left for r1 to replace.
    const plan = planSolidRender([extrude('e1', 'newBody'), revolve('r1', 'cut')])
    expect([...plan.rendered]).toEqual(['r1'])
    expect(plan.supersedes.get('r1')).toEqual([])
  })

  it('evaluates only the last two stages of a long fillet history', () => {
    const plan = planSolidRender([
      extrude('e1', 'newBody'),
      fillet('f1'), fillet('f2'), fillet('f3'), fillet('f4'), fillet('f5'),
    ])
    expect([...plan.rendered]).toEqual(['f4', 'f5'])
    expect(plan.supersedes.get('f5')).toEqual(['f4'])
  })
})
