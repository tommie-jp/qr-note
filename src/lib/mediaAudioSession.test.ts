import { describe, expect, test, vi } from 'vitest'
import { buildSilentWavBytes, isAppleTouchDevice } from './mediaAudioSession'

vi.mock('./diagLog', () => ({ logDiagEvent: vi.fn() }))

const ascii = (bytes: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...bytes.slice(from, from + length))

describe('buildSilentWavBytes', () => {
  test('WAV として読める形になっている', () => {
    // Arrange / Act — 壊れた WAV は再生されず、小技が黙って効かなくなる
    const bytes = buildSilentWavBytes()

    // Assert
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(ascii(bytes, 8, 4)).toBe('WAVE')
    expect(ascii(bytes, 12, 4)).toBe('fmt ')
    expect(ascii(bytes, 36, 4)).toBe('data')
  })

  test('宣言した長さと実体の長さが合っている', () => {
    // Arrange
    const bytes = buildSilentWavBytes()
    const view = new DataView(bytes.buffer)

    // Act
    const riffLength = view.getUint32(4, true)
    const dataLength = view.getUint32(40, true)

    // Assert
    expect(bytes.length).toBe(44 + dataLength)
    expect(riffLength).toBe(bytes.length - 8)
  })

  test('中身は 8bit PCM の無音 (中央値) で埋まっている', () => {
    // Arrange / Act
    const bytes = buildSilentWavBytes()

    // Assert — 0 で埋めると 8bit PCM では最小振幅になり、耳障りな音が出る
    expect(bytes.slice(44).every((v) => v === 128)).toBe(true)
  })
})

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
      isAppleTouchDevice({ userAgent: 'Macintosh; Intel Mac OS X', maxTouchPoints: 5 }),
    ).toBe(true)
    expect(
      isAppleTouchDevice({ userAgent: 'Macintosh; Intel Mac OS X', maxTouchPoints: 0 }),
    ).toBe(false)
  })

  test('PC と Android では何もしない (動く物に副作用を足さない)', () => {
    // Arrange / Act / Assert
    expect(isAppleTouchDevice({ userAgent: 'Windows NT 10.0' })).toBe(false)
    expect(isAppleTouchDevice({ userAgent: 'Linux; Android 14' })).toBe(false)
    expect(isAppleTouchDevice(undefined)).toBe(false)
  })
})
