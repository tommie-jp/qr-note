import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  isUnlocked,
  lockSecrets,
  SECRET_HIDDEN_LOCK_MS,
  SECRET_IDLE_LOCK_MS,
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

// 自動施錠 (2026-11 の監査 M-7)。鍵を使わない間は持たない
describe('auto lock', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('最後に鍵を使ってから無操作が続くと施錠する', async () => {
    vi.useFakeTimers()
    await unlockWith(RAW)

    vi.advanceTimersByTime(SECRET_IDLE_LOCK_MS - 1)
    expect(isUnlocked()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isUnlocked()).toBe(false)
  })

  test('鍵を使えば数え直す', async () => {
    vi.useFakeTimers()
    await unlockWith(RAW)

    vi.advanceTimersByTime(SECRET_IDLE_LOCK_MS - 1000)
    expect(unlockedKey()).not.toBeNull()
    vi.advanceTimersByTime(SECRET_IDLE_LOCK_MS - 1000)
    expect(isUnlocked()).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(isUnlocked()).toBe(false)
  })

  test('タブが隠れて一定時間経つと施錠し、戻れば取り消す', async () => {
    vi.useFakeTimers()
    const listeners = new Map<string, () => void>()
    const fakeDocument = {
      visibilityState: 'visible' as 'visible' | 'hidden',
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    }
    vi.stubGlobal('document', fakeDocument)
    vi.stubGlobal('window', { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) })
    await unlockWith(RAW)

    fakeDocument.visibilityState = 'hidden'
    listeners.get('visibilitychange')?.()
    vi.advanceTimersByTime(SECRET_HIDDEN_LOCK_MS - 1)
    expect(isUnlocked()).toBe(true)
    fakeDocument.visibilityState = 'visible'
    listeners.get('visibilitychange')?.()
    vi.advanceTimersByTime(SECRET_HIDDEN_LOCK_MS)
    expect(isUnlocked()).toBe(true)

    fakeDocument.visibilityState = 'hidden'
    listeners.get('visibilitychange')?.()
    vi.advanceTimersByTime(SECRET_HIDDEN_LOCK_MS)
    expect(isUnlocked()).toBe(false)

    // 頁を離れるときも施錠
    await unlockWith(RAW)
    listeners.get('pagehide')?.()
    expect(isUnlocked()).toBe(false)
  })

  test('施錠するとタイマーも止まる (後から解錠した鍵を巻き込まない)', async () => {
    vi.useFakeTimers()
    await unlockWith(RAW)
    lockSecrets()
    vi.advanceTimersByTime(1000)
    await unlockWith(RAW)
    vi.advanceTimersByTime(SECRET_IDLE_LOCK_MS - 1000)
    expect(isUnlocked()).toBe(true)
  })
})
