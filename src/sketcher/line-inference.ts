import type { Vec2 } from '../core/model'

const SMART_INCREMENT_RADIANS = Math.PI / 4
const SMART_TOLERANCE_RADIANS = 4 * Math.PI / 180
const EXACT_TOLERANCE_RADIANS = 1e-7

function distance(start: Vec2, end: Vec2) {
  return Math.hypot(end[0] - start[0], end[1] - start[1])
}

function angleDifference(first: number, second: number) {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)))
}

/**
 * The angular inference currently acquired by a line.
 *
 * An increment of zero is Smart mode: only common 45° marks acquire, and only
 * within a small magnetic window. Explicit increments remain strict. Geometry
 * targets use exact matching so angle inference never pulls a point away from
 * the endpoint, midpoint or line the user deliberately acquired.
 */
export function inferredLineAngle(
  start: Vec2,
  end: Vec2,
  incrementDegrees: 0 | 15 | 30 | 45,
  geometryTarget = false,
  smartToleranceDegrees = 4,
): number | null {
  if (distance(start, end) < 1e-9) return null
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0])
  const increment = incrementDegrees === 0
    ? SMART_INCREMENT_RADIANS
    : incrementDegrees * Math.PI / 180
  const inferred = Math.round(angle / increment) * increment
  if (incrementDegrees > 0 && !geometryTarget) return inferred
  const tolerance = geometryTarget
    ? EXACT_TOLERANCE_RADIANS
    : smartToleranceDegrees === 4 ? SMART_TOLERANCE_RADIANS : smartToleranceDegrees * Math.PI / 180
  return angleDifference(angle, inferred) <= tolerance ? inferred : null
}

export function snapLineEnd(
  start: Vec2,
  end: Vec2,
  incrementDegrees: 0 | 15 | 30 | 45,
  lengthIncrement = 1,
  smartToleranceDegrees = 4,
): Vec2 {
  const length = distance(start, end)
  if (length < 1e-9) return end
  const angle = inferredLineAngle(start, end, incrementDegrees, false, smartToleranceDegrees)
  if (angle === null) return end
  const snappedLength = incrementDegrees === 0
    ? length
    : Math.max(lengthIncrement, Math.round(length / lengthIncrement) * lengthIncrement)
  return [start[0] + Math.cos(angle) * snappedLength, start[1] + Math.sin(angle) * snappedLength]
}

export type AngleBreakawayState = {
  latchedAngle: number | null
  fine: boolean
  lastPointer: Vec2
  lastTime: number
}

export function beginAngleBreakaway(pointer: Vec2, time: number): AngleBreakawayState {
  return { latchedAngle: null, fine: false, lastPointer: pointer, lastTime: time }
}

/**
 * Release a Smart-angle latch when the pointer is deliberately eased away.
 *
 * Fast motion retains the magnetic 4° acquisition window. Motion below
 * 120 px/s that reaches 0.75° off the acquired mark enters fine mode, shrinking
 * that window to 0.25° for the rest of the nearby adjustment.
 */
export function updateAngleBreakaway(
  state: AngleBreakawayState,
  start: Vec2,
  rawEnd: Vec2,
  pointer: Vec2,
  time: number,
): AngleBreakawayState {
  const elapsed = Math.max(1, time - state.lastTime)
  const speed = Math.hypot(pointer[0] - state.lastPointer[0], pointer[1] - state.lastPointer[1]) / elapsed
  const commonAngle = inferredLineAngle(start, rawEnd, 0, false, 4)
  const next = { ...state, lastPointer: pointer, lastTime: time }

  if (commonAngle === null) return { ...next, latchedAngle: null, fine: false }
  if (state.fine) return next
  if (state.latchedAngle === null || Math.abs(commonAngle - state.latchedAngle) > 1e-7) {
    return { ...next, latchedAngle: commonAngle }
  }

  const rawAngle = Math.atan2(rawEnd[1] - start[1], rawEnd[0] - start[0])
  const offset = Math.abs(Math.atan2(
    Math.sin(rawAngle - state.latchedAngle),
    Math.cos(rawAngle - state.latchedAngle),
  ))
  return speed <= 0.12 && offset >= 0.75 * Math.PI / 180
    ? { ...next, fine: true }
    : next
}
