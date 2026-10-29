import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { afterNextPaint } from './afterNextPaint'

// テスト環境は node なので requestAnimationFrame を手で置く。
// 描画の 1 枚を flushFrame() で進める
let frames: Map<number, FrameRequestCallback>
let nextId: number
const flushFrame = () => {
  const pending = [...frames.values()]
  frames = new Map()
  for (const cb of pending) cb(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  nextId = 1
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('次の描画の後の手番で呼ぶ (描画の前には呼ばない)', () => {
  const fn = vi.fn()
  afterNextPaint(fn)
  vi.runAllTimers()
  expect(fn).not.toHaveBeenCalled()
  flushFrame()
  expect(fn).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(fn).toHaveBeenCalledTimes(1)
})

test('描画の前に取り消せば呼ばない', () => {
  const fn = vi.fn()
  const cancel = afterNextPaint(fn)
  cancel()
  flushFrame()
  vi.runAllTimers()
  expect(fn).not.toHaveBeenCalled()
})

test('描画の後・呼ぶ前に取り消しても呼ばない', () => {
  const fn = vi.fn()
  const cancel = afterNextPaint(fn)
  flushFrame()
  cancel()
  vi.runAllTimers()
  expect(fn).not.toHaveBeenCalled()
})
