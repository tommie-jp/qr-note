import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { withTimeout } from './withTimeout'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('期限内に終われば値をそのまま返す', async () => {
  // Arrange
  const task = Promise.resolve(42)

  // Act
  const value = await withTimeout(task, 1000, 'db')

  // Assert
  expect(value).toBe(42)
})

test('期限を過ぎたら何を待っていたかを名指しして投げる', async () => {
  // Arrange
  const never = new Promise<number>(() => {})

  // Act
  const pending = withTimeout(never, 1000, 'db')
  const assertion = expect(pending).rejects.toThrow('db が 1000ms 以内に応答しない')
  await vi.advanceTimersByTimeAsync(1000)

  // Assert
  await assertion
})

test('失敗はそのまま伝える (時間切れに言い換えない)', async () => {
  // Arrange
  const boom = new Error('boom')

  // Act / Assert
  await expect(withTimeout(Promise.reject(boom), 1000, 'db')).rejects.toBe(boom)
})
