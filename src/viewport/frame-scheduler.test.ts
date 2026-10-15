import { describe, expect, it } from 'vitest'
import { FrameScheduler } from './frame-scheduler'

describe('FrameScheduler', () => {
  it('draws the first frame, then nothing while idle', () => {
    const frames = new FrameScheduler()
    expect(frames.shouldDraw(false)).toBe(true)
    expect(frames.shouldDraw(false)).toBe(false)
    expect(frames.shouldDraw(false)).toBe(false)
  })

  it('draws once for any number of requests between frames', () => {
    const frames = new FrameScheduler()
    frames.shouldDraw(false)
    frames.request()
    frames.request()
    expect(frames.shouldDraw(false)).toBe(true)
    expect(frames.shouldDraw(false)).toBe(false)
  })

  it('draws while the camera moves, including orbit damping after release', () => {
    const frames = new FrameScheduler()
    frames.shouldDraw(false)
    expect(frames.shouldDraw(true)).toBe(true)
    expect(frames.shouldDraw(true)).toBe(true)
    expect(frames.shouldDraw(false)).toBe(false)
  })
})
