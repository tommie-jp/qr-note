import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { createExternalStore, createNotifier } from './externalStore'

describe('createNotifier', () => {
  test('購読者へ知らせ、解除した購読者には知らせない', () => {
    // Arrange
    const notifier = createNotifier()
    const kept = vi.fn()
    const dropped = vi.fn()
    notifier.subscribe(kept)
    const unsubscribe = notifier.subscribe(dropped)

    // Act
    notifier.notify()
    unsubscribe()
    notifier.notify()

    // Assert
    expect(kept).toHaveBeenCalledTimes(2)
    expect(dropped).toHaveBeenCalledTimes(1)
  })

  test('同じ購読者を 2 回登録しても 1 回だけ呼ぶ (Set の意味を保つ)', () => {
    // Arrange
    const notifier = createNotifier()
    const listener = vi.fn()
    notifier.subscribe(listener)
    notifier.subscribe(listener)

    // Act
    notifier.notify()

    // Assert
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('createExternalStore', () => {
  test('初期値は最初に読まれるまで作らず、作るのは 1 回だけ', () => {
    // Arrange
    const initial = vi.fn(() => 'first')
    const store = createExternalStore({ initial, serverSnapshot: 'server' })

    // Act / Assert
    expect(initial).not.toHaveBeenCalled()
    expect(store.get()).toBe('first')
    expect(store.get()).toBe('first')
    expect(initial).toHaveBeenCalledTimes(1)
  })

  test('初期値が null でも読み直さない', () => {
    // Arrange
    const initial = vi.fn(() => null)
    const store = createExternalStore<string | null>({ initial, serverSnapshot: null })

    // Act
    store.get()
    store.get()

    // Assert
    expect(initial).toHaveBeenCalledTimes(1)
  })

  test('スナップショットは set されるまで同じ参照を返す (描画が回り続けない)', () => {
    // Arrange
    const store = createExternalStore({
      initial: () => ({ n: 1 }),
      serverSnapshot: { n: 0 },
    })

    // Act
    const first = store.get()
    const second = store.get()

    // Assert
    expect(second).toBe(first)
  })

  test('set で値が替わり、購読者へ知らせる', () => {
    // Arrange
    const store = createExternalStore({ initial: () => 1, serverSnapshot: 0 })
    const listener = vi.fn(() => store.get())
    store.subscribe(listener)

    // Act
    store.set(2)

    // Assert
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveReturnedWith(2)
    expect(store.get()).toBe(2)
  })

  test('同じ値を set しても知らせる (React 以外の購読者の後始末のため)', () => {
    // Arrange
    const store = createExternalStore<string | null>({
      initial: () => null,
      serverSnapshot: null,
    })
    const listener = vi.fn()
    store.subscribe(listener)

    // Act
    store.set(null)
    store.set(null)

    // Assert
    expect(listener).toHaveBeenCalledTimes(2)
  })

  test('読む前に set すれば初期値は作らない', () => {
    // Arrange
    const initial = vi.fn(() => 'stored')
    const store = createExternalStore({ initial, serverSnapshot: 'server' })

    // Act
    store.set('chosen')

    // Assert
    expect(store.get()).toBe('chosen')
    expect(initial).not.toHaveBeenCalled()
  })

  test('解除した購読者には知らせない', () => {
    // Arrange
    const store = createExternalStore({ initial: () => 1, serverSnapshot: 0 })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    // Act
    unsubscribe()
    store.set(2)

    // Assert
    expect(listener).not.toHaveBeenCalled()
  })

  test('サーバ描画では端末の値ではなく serverSnapshot で描く', () => {
    // Arrange
    const store = createExternalStore({
      initial: () => 'device',
      serverSnapshot: 'server',
    })
    store.get()
    function View() {
      return createElement('span', null, store.useStore())
    }

    // Act
    const html = renderToStaticMarkup(createElement(View))

    // Assert
    expect(html).toBe('<span>server</span>')
  })
})
