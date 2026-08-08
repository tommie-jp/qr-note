import { afterEach, describe, expect, test } from 'vitest'

import { AUTO_SYNC_INTERVAL_MS, readMark, shouldAutoSync, writeMark } from './schedule'

const NOW = 1_800_000_000_000

describe('shouldAutoSync', () => {
  test('一度も同期していなければ同期する', () => {
    expect(shouldAutoSync(null, NOW)).toBe(true)
  })

  test('間隔を過ぎていれば同期する', () => {
    expect(shouldAutoSync(String(NOW - AUTO_SYNC_INTERVAL_MS - 1), NOW)).toBe(true)
  })

  test('間隔の内なら同期しない (シールを何枚も読むときの通信を抑える)', () => {
    expect(shouldAutoSync(String(NOW - 1000), NOW)).toBe(false)
  })

  // localStorage は手で編集できる外部入力。読めない値で同期が永久に止まる
  // ほうが、余分に 1 回同期するより害が大きい
  test('読めない値は同期する側に倒す', () => {
    expect(shouldAutoSync('あとで', NOW)).toBe(true)
    expect(shouldAutoSync('', NOW)).toBe(true)
    expect(shouldAutoSync('NaN', NOW)).toBe(true)
  })

  // 端末の時計を進めて戻した後など。未来の値をそのまま信じると、その時刻に
  // なるまで同期が止まる
  test('未来の記録は信じずに同期する', () => {
    expect(shouldAutoSync(String(NOW + 60_000), NOW)).toBe(true)
  })
})

// localStorage は「触るだけで落ちうる」外部資源。ここで投げると、呼び出し元の
// 効果を突き抜けて unhandled rejection になり、オフラインの下ごしらえが
// 丸ごと黙って動かなくなる (schedule.ts の readMark/writeMark 参照)
describe('readMark / writeMark', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, 'window', original)
    } else {
      delete (globalThis as { window?: unknown }).window
    }
  })

  function installWindow(localStorage: unknown) {
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage },
      configurable: true,
      writable: true,
    })
  }

  test('読み書きが往復する', () => {
    // Arrange
    const store = new Map<string, string>()
    installWindow({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })

    // Act
    writeMark('k', '42')

    // Assert
    expect(readMark('k')).toBe('42')
  })

  test('window が無ければ null (サーバ側の描画)', () => {
    delete (globalThis as { window?: unknown }).window
    expect(readMark('k')).toBeNull()
    expect(() => writeMark('k', '1')).not.toThrow()
  })

  // Firefox の dom.storage.enabled=false は **例外を出さずに** undefined になる
  test('localStorage が undefined でも落ちない', () => {
    installWindow(undefined)
    expect(readMark('k')).toBeNull()
    expect(() => writeMark('k', '1')).not.toThrow()
  })

  // Safari のブロック時は getItem / setItem 側が SecurityError を投げる
  test('getItem / setItem が投げても落ちない', () => {
    installWindow({
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(readMark('k')).toBeNull()
    expect(() => writeMark('k', '1')).not.toThrow()
  })

  // 読めない = 「記録が無い」= 同期する側へ倒れることを、実際に繋いで確かめる
  test('読めないときは同期する側へ倒れる', () => {
    installWindow(undefined)
    expect(shouldAutoSync(readMark('k'), NOW)).toBe(true)
  })
})
