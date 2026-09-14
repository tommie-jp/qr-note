import { describe, expect, test } from 'vitest'
import { pendingRotation } from './rotationState'

describe('pendingRotation', () => {
  test('90 / 180 / 270 はそのまま送る', () => {
    expect(pendingRotation(90)).toBe(90)
    expect(pendingRotation(180)).toBe(180)
    expect(pendingRotation(270)).toBe(270)
  })

  test('一周して 360 (= 0) に戻ったら送らない', () => {
    expect(pendingRotation(360)).toBeNull()
    expect(pendingRotation(0)).toBeNull()
  })

  test('連打で 360 を超えても正規化して送る (450 → 90)', () => {
    expect(pendingRotation(450)).toBe(90)
    expect(pendingRotation(540)).toBe(180)
    expect(pendingRotation(720)).toBeNull()
  })
})
