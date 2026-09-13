import { expect, test, vi } from 'vitest'
import { stopStream } from './mediaStream'

test('映像も音声も、すべての track を止める', () => {
  // Arrange
  const video = { stop: vi.fn() }
  const audio = { stop: vi.fn() }
  const stream = { getTracks: () => [video, audio] }

  // Act
  stopStream(stream)

  // Assert
  expect(video.stop).toHaveBeenCalledTimes(1)
  expect(audio.stop).toHaveBeenCalledTimes(1)
})

test('track の無いストリームでも投げない', () => {
  // Arrange
  const stream = { getTracks: () => [] }

  // Act / Assert
  expect(() => stopStream(stream)).not.toThrow()
})

test('まだ開いていない (null / undefined) なら何もしない', () => {
  // Arrange / Act / Assert
  expect(() => stopStream(null)).not.toThrow()
  expect(() => stopStream(undefined)).not.toThrow()
})
