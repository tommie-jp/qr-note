// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SCROLLBARS_INIT_SCRIPT,
  SCROLLBARS_STORAGE_KEY,
  applyScrollbarMode,
  loadScrollbarMode,
  parseScrollbarMode,
} from './scrollbars'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-scrollbars')
})

describe('スクロールバーの設定', () => {
  it('覚えていない・読めない値は既定の「隠す」', () => {
    expect(parseScrollbarMode(null)).toBe('hidden')
    expect(parseScrollbarMode('auto')).toBe('hidden')
    expect(parseScrollbarMode('shown')).toBe('shown')
  })

  it('Storage が投げても既定で読める', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(loadScrollbarMode(throwing)).toBe('hidden')
    expect(loadScrollbarMode(null)).toBe('hidden')
  })

  it('選ぶと端末に覚えて html に当てる', () => {
    const storage = memoryStorage()
    applyScrollbarMode(storage, 'shown')
    expect(storage.getItem(SCROLLBARS_STORAGE_KEY)).toBe('shown')
    expect(document.documentElement.getAttribute('data-scrollbars')).toBe('shown')
    expect(loadScrollbarMode(storage)).toBe('shown')
  })

  it('初回スクリプトは覚えた値を、無ければ既定を html に書く', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    new Function(SCROLLBARS_INIT_SCRIPT)()
    expect(document.documentElement.getAttribute('data-scrollbars')).toBe('hidden')
    storage.setItem(SCROLLBARS_STORAGE_KEY, 'shown')
    new Function(SCROLLBARS_INIT_SCRIPT)()
    expect(document.documentElement.getAttribute('data-scrollbars')).toBe('shown')
  })
})
