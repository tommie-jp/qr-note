import { describe, expect, test, vi } from 'vitest'
import { onPageLoaded } from './pageLoad'

// window の load を模す。テストは environment: 'node' で走るので注入して確かめる
function fakeWindow() {
  let listeners: Array<() => void> = []
  return {
    addEventListener: (_type: 'load', listener: () => void) => {
      listeners.push(listener)
    },
    removeEventListener: (_type: 'load', listener: () => void) => {
      listeners = listeners.filter((one) => one !== listener)
    },
    fireLoad: () => {
      for (const listener of [...listeners]) {
        listener()
      }
    },
    listenerCount: () => listeners.length,
  }
}

describe('onPageLoaded', () => {
  test('runs immediately when the page has already loaded', () => {
    // Arrange: complete は load が済んだ状態。ここで待つと永久に来ない
    const win = fakeWindow()
    const run = vi.fn()

    // Act
    onPageLoaded(run, win, { readyState: 'complete' })

    // Assert
    expect(run).toHaveBeenCalledTimes(1)
    expect(win.listenerCount()).toBe(0)
  })

  test('waits for load while the page is still loading', () => {
    // Arrange
    const win = fakeWindow()
    const run = vi.fn()

    // Act
    onPageLoaded(run, win, { readyState: 'loading' })

    // Assert: まだ走らない — 読み込み中に重い通信を始めないことが目的
    expect(run).not.toHaveBeenCalled()

    win.fireLoad()
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('runs at most once even if load fires again', () => {
    const win = fakeWindow()
    const run = vi.fn()

    onPageLoaded(run, win, { readyState: 'loading' })
    win.fireLoad()
    win.fireLoad()

    expect(run).toHaveBeenCalledTimes(1)
  })

  test('the returned function cancels the wait', () => {
    // Arrange: React の効果が外れたあとに走らせない
    const win = fakeWindow()
    const run = vi.fn()

    // Act
    const cancel = onPageLoaded(run, win, { readyState: 'loading' })
    cancel()
    win.fireLoad()

    // Assert
    expect(run).not.toHaveBeenCalled()
    expect(win.listenerCount()).toBe(0)
  })
})
