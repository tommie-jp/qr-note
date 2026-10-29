import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CircuitMap } from '@/lib/circuit/types'
import { circuitsCache, noteCache, PendingCircuits, renderCache } from './noteStore'

// ノートの控え (docs/123 §3-2)。応答の形の検めと、描き終える前の回路図の表を固定する

let body: unknown = null

beforeEach(() => {
  noteCache.remove(() => true)
  renderCache.remove(() => true)
  circuitsCache.remove(() => true)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('noteCache', () => {
  test('未登録の id は item: null で受ける (その場で書いて作れる)', async () => {
    // Arrange
    body = { success: true, data: { item: null }, error: null }

    // Act / Assert
    await expect(noteCache.load('new-id')).resolves.toEqual({ item: null })
  })

  test('形の違うノートは受け取らない', async () => {
    // Arrange
    body = { success: true, data: { item: { itemId: 'x' } }, error: null }

    // Act / Assert
    await expect(noteCache.load('x')).rejects.toThrow('ノートの形が違います')
  })
})

describe('renderCache / circuitsCache', () => {
  test('添付量だけのときは ?only=bytes で引く', async () => {
    // Arrange
    body = { success: true, data: { matrices: [], health: [], attachmentBytes: 3 }, error: null }

    // Act
    await renderCache.load({ itemId: 'id', full: false })

    // Assert
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/items/id/render?only=bytes')
  })

  test('組の配列を Map に戻す', async () => {
    // Arrange
    body = {
      success: true,
      data: { matrices: [['m', { kind: 'error', error: 'e' }]], health: [], attachmentBytes: 12 },
      error: null,
    }

    // Act
    const render = await renderCache.load({ itemId: 'id', full: true })

    // Assert
    expect(render.matrices.get('m')).toEqual({ kind: 'error', error: 'e' })
    expect(render.attachmentBytes).toBe(12)
  })

  test('回路図の組の形が違えば受け取らない', async () => {
    // Arrange
    body = { success: true, data: { circuits: [['only-key']] }, error: null }

    // Act / Assert
    await expect(circuitsCache.load('id')).rejects.toThrow('回路図の形が違います')
  })
})

describe('PendingCircuits', () => {
  test('同じ鍵には同じ約束を返し続ける (Suspense が抜けるため)', async () => {
    // Arrange
    const source = Promise.resolve<CircuitMap>(new Map([['k', { svg: '<svg/>' }]]))
    const pending = new PendingCircuits(source)

    // Act
    const first = pending.get('k')
    const second = pending.get('k')

    // Assert
    expect(first).toBe(second)
    await expect(first).resolves.toEqual({ svg: '<svg/>' })
  })

  test('届いた表に無い鍵・取得の失敗は図の場所に断りを出す', async () => {
    // Arrange
    const missing = new PendingCircuits(Promise.resolve<CircuitMap>(new Map()))
    const failed = new PendingCircuits(Promise.reject(new Error('圏外')))

    // Act / Assert
    await expect(missing.get('k')).resolves.toMatchObject({ error: expect.stringContaining('読み込めませんでした') })
    await expect(failed.get('k')).resolves.toMatchObject({ error: expect.stringContaining('通信の失敗') })
  })

  test('先に入れた古い図はそのまま返す (変わっていない図は待たせない)', () => {
    // Arrange
    const pending = new PendingCircuits(new Promise<CircuitMap>(() => {}))
    pending.set('old', { svg: '<svg id="old"/>' })

    // Act / Assert
    expect(pending.get('old')).toEqual({ svg: '<svg id="old"/>' })
  })
})
