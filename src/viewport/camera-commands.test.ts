import { describe, expect, it, vi } from 'vitest'
import { onCameraCommand, onCameraOrientation, publishCameraOrientation, sendCameraCommand } from './camera-commands'

describe('camera commands', () => {
  it('delivers each command to every listener until it unsubscribes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = onCameraCommand(first)
    const stopSecond = onCameraCommand(second)
    sendCameraCommand({ kind: 'view', view: 'top' })
    stopFirst()
    sendCameraCommand({ kind: 'roll', degrees: 90 })
    stopSecond()
    expect(first.mock.calls).toEqual([[{ kind: 'view', view: 'top' }]])
    expect(second.mock.calls).toEqual([[{ kind: 'view', view: 'top' }], [{ kind: 'roll', degrees: 90 }]])
  })

  it('keeps orientation reports separate from commands', () => {
    const command = vi.fn()
    const orientation = vi.fn()
    const stops = [onCameraCommand(command), onCameraOrientation(orientation)]
    publishCameraOrientation([0, 0, 0, 1])
    for (const stop of stops) stop()
    expect(command).not.toHaveBeenCalled()
    expect(orientation).toHaveBeenCalledWith([0, 0, 0, 1])
  })
})
