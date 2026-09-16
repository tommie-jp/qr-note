import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  isUnlocked,
  lockSecrets,
  subscribeSecretLock,
  unlockedKey,
  unlockedMasterKeyBytes,
  unlockWith,
  useSecretUnlocked,
} from './session'

// 解錠中のマスターキーの置き場 (docs/51-部分暗号化計画.md §6)。
// モジュール変数に持つので、テストごとに施錠して次へ持ち越さない

const RAW = new Uint8Array(32).fill(5)

afterEach(() => {
  lockSecrets()
})

describe('unlockWith', () => {
  test('解錠すると鍵と生バイト列の両方が読める', async () => {
    // Arrange
    expect(isUnlocked()).toBe(false)

    // Act
    await unlockWith(RAW)

    // Assert
    expect(isUnlocked()).toBe(true)
    expect(unlockedKey()).toBeInstanceOf(CryptoKey)
    expect(Array.from(unlockedMasterKeyBytes() ?? [])).toEqual(Array.from(RAW))
  })

  test('鍵は非 extractable の AES-GCM (取り出せない形で持つ)', async () => {
    await unlockWith(RAW)

    const key = unlockedKey()

    expect(key?.extractable).toBe(false)
    expect(key?.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
  })

  test('生バイト列は写しを返す (返り値を書き換えても次の呼び出しに影響しない)', async () => {
    // Arrange
    await unlockWith(RAW)
    const first = unlockedMasterKeyBytes()

    // Act
    first?.fill(0)

    // Assert
    expect(Array.from(unlockedMasterKeyBytes() ?? [])).toEqual(Array.from(RAW))
  })

  test('渡したバイト列を後から書き換えても解錠中の鍵は変わらない', async () => {
    // Arrange
    const raw = Uint8Array.from(RAW)
    await unlockWith(raw)

    // Act
    raw.fill(0)

    // Assert
    expect(Array.from(unlockedMasterKeyBytes() ?? [])).toEqual(Array.from(RAW))
  })
})

describe('lockSecrets', () => {
  test('施錠すると全部 null / false に戻る', async () => {
    // Arrange
    await unlockWith(RAW)

    // Act
    lockSecrets()

    // Assert
    expect(isUnlocked()).toBe(false)
    expect(unlockedKey()).toBe(null)
    expect(unlockedMasterKeyBytes()).toBe(null)
  })

  test('未解錠のうちは null / false', () => {
    expect(isUnlocked()).toBe(false)
    expect(unlockedKey()).toBe(null)
    expect(unlockedMasterKeyBytes()).toBe(null)
  })
})

describe('subscribeSecretLock', () => {
  test('解錠でも施錠でも呼ばれ、解除した後は呼ばれない', async () => {
    // Arrange
    const listener = vi.fn(() => isUnlocked())
    const unsubscribe = subscribeSecretLock(listener)

    // Act
    await unlockWith(RAW)
    lockSecrets()
    unsubscribe()
    await unlockWith(RAW)
    lockSecrets()

    // Assert — 1 回目は解錠済み、2 回目は施錠済みの状態で呼ばれる
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveNthReturnedWith(1, true)
    expect(listener).toHaveNthReturnedWith(2, false)
  })
})

describe('useSecretUnlocked', () => {
  // 鍵はブラウザにしかないので、サーバ描画は常に施錠済みとして描く
  // (解錠中の状態を持ち越したモジュールでも同じ)
  test('サーバ描画では解錠中でも false', async () => {
    // Arrange
    await unlockWith(RAW)
    function View() {
      return createElement('span', null, useSecretUnlocked() ? 'unlocked' : 'locked')
    }

    // Act
    const html = renderToStaticMarkup(createElement(View))

    // Assert
    expect(html).toBe('<span>locked</span>')
  })
})
