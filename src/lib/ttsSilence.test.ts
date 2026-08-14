import { describe, expect, test } from 'vitest'
import {
  TTS_SILENT_APPLE_MESSAGE,
  TTS_SILENT_GENERIC_MESSAGE,
  isAppleTouchDevice,
  ttsSilenceMessage,
} from './ttsSilence'

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
