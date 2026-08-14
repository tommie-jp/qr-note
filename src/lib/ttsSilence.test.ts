import { describe, expect, test } from 'vitest'
import {
  TTS_HINT_STORAGE_KEY,
  TTS_SILENT_APPLE_MESSAGE,
  TTS_SILENT_GENERIC_MESSAGE,
  dismissTtsHint,
  isAppleTouchDevice,
  isTtsHintDismissed,
  shouldShowTtsHint,
  ttsSilenceMessage,
} from './ttsSilence'

const IPHONE = { userAgent: 'iPhone; CPU iPhone OS 18_0' }

// 使う分だけの localStorage。読み書きが投げる環境も作れるようにする
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    data,
  }
}

describe('isAppleTouchDevice', () => {
  test('iPhone / iPad を見分ける', () => {
    // Arrange / Act / Assert
    expect(isAppleTouchDevice({ userAgent: 'iPhone; CPU iPhone OS 18_0' })).toBe(
      true,
    )
    expect(isAppleTouchDevice({ userAgent: 'iPad; CPU OS 18_0' })).toBe(true)
  })

  test('Macintosh を名乗る iPad は触れる画面かで見分ける', () => {
    // Arrange / Act / Assert — iPadOS 13 以降は Mac の UA を送る
    expect(
      isAppleTouchDevice({
        userAgent: 'Macintosh; Intel Mac OS X',
        maxTouchPoints: 5,
      }),
    ).toBe(true)
    expect(
      isAppleTouchDevice({
        userAgent: 'Macintosh; Intel Mac OS X',
        maxTouchPoints: 0,
      }),
    ).toBe(false)
  })

  test('PC と Android は Apple 端末ではない', () => {
    // Arrange / Act / Assert
    expect(isAppleTouchDevice({ userAgent: 'Windows NT 10.0' })).toBe(false)
    expect(isAppleTouchDevice({ userAgent: 'Linux; Android 14' })).toBe(false)
    expect(isAppleTouchDevice(undefined)).toBe(false)
  })
})

describe('ttsSilenceMessage', () => {
  test('iPhone には着信音量の直し方を出す', () => {
    // Arrange / Act
    const message = ttsSilenceMessage({ userAgent: 'iPhone; CPU iPhone OS 18_0' })

    // Assert — 片方だけ直しても鳴らないので、両方に触れていること
    expect(message).toBe(TTS_SILENT_APPLE_MESSAGE)
    expect(message).toContain('消音')
    expect(message).toContain('着信音量')
  })

  test('それ以外の端末では原因を断定しない', () => {
    // Arrange / Act
    const message = ttsSilenceMessage({ userAgent: 'Windows NT 10.0' })

    // Assert
    expect(message).toBe(TTS_SILENT_GENERIC_MESSAGE)
    expect(message).not.toContain('着信音量')
  })
})

describe('shouldShowTtsHint', () => {
  test('iPhone には出す (消音かどうかは判定できないので、鳴らした回に添える)', () => {
    // Arrange / Act / Assert
    expect(shouldShowTtsHint(fakeStorage(), IPHONE)).toBe(true)
  })

  test('消したら二度と出さない', () => {
    // Arrange
    const storage = fakeStorage()

    // Act
    dismissTtsHint(storage)

    // Assert
    expect(storage.data[TTS_HINT_STORAGE_KEY]).toBe('1')
    expect(shouldShowTtsHint(storage, IPHONE)).toBe(false)
  })

  test('PC と Android には出さない (着信音量で鳴るのは iOS の作法)', () => {
    // Arrange / Act / Assert — 的外れな案内は害になる
    expect(shouldShowTtsHint(fakeStorage(), { userAgent: 'Windows NT 10.0' })).toBe(
      false,
    )
    expect(
      shouldShowTtsHint(fakeStorage(), { userAgent: 'Linux; Android 14' }),
    ).toBe(false)
  })

  test('localStorage を読めない環境では出し続ける', () => {
    // Arrange — プライベートモード等。案内は保険なので、黙るよりうるさく倒す
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }

    // Act / Assert
    expect(isTtsHintDismissed(throwing)).toBe(false)
    expect(() => dismissTtsHint(throwing)).not.toThrow()
    expect(shouldShowTtsHint(throwing, IPHONE)).toBe(true)
  })
})
