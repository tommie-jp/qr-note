import { describe, expect, test } from 'vitest'
import { voice } from '@/test/fakeSpeech'
import { describeVoice, pickEnglishVoice } from './voices'

describe('pickEnglishVoice', () => {
  test('日本語端末でも英語の声を選ぶ (既定の Kyoko を選ばない)', () => {
    // Arrange — 日本語 iPhone の並び。既定は Kyoko
    const voices = [
      voice('Kyoko', 'ja-JP'),
      voice('Samantha', 'en-US'),
      voice('Daniel', 'en-GB'),
    ]

    // Act
    const picked = pickEnglishVoice(voices)

    // Assert
    expect(picked?.name).toBe('Samantha')
  })

  test('先頭にある冗談の声 (Albert など) を選ばない', () => {
    // Arrange — iOS の英語 (US) 一覧は Albert のような声から始まる
    const voices = [
      voice('Albert', 'en-US'),
      voice('Bad News', 'en-US'),
      voice('Samantha', 'en-US'),
    ]

    // Act
    const picked = pickEnglishVoice(voices)

    // Assert
    expect(picked?.name).toBe('Samantha')
  })

  test('拡張版をダウンロードしてあれば自然な声を優先する', () => {
    // Arrange — Ava は追加ダウンロードの声。あるなら選ばれたということ
    const voices = [voice('Samantha', 'en-US'), voice('Ava', 'en-US')]

    // Act
    const picked = pickEnglishVoice(voices)

    // Assert
    expect(picked?.name).toBe('Ava')
  })

  test('US が無ければ他の英語で代用する', () => {
    // Arrange
    const voices = [voice('Kyoko', 'ja-JP'), voice('Daniel', 'en-GB')]

    // Act
    const picked = pickEnglishVoice(voices)

    // Assert
    expect(picked?.name).toBe('Daniel')
  })

  test('en_US のような区切りの違いも英語と見なす', () => {
    // Arrange — Android は en_US と書く
    const voices = [voice('English United States', 'en_US')]

    // Act / Assert
    expect(pickEnglishVoice(voices)?.lang).toBe('en_US')
  })

  test('冗談の声しか無ければそれで鳴らす (無音にしない)', () => {
    // Arrange
    const voices = [voice('Albert', 'en-US')]

    // Act / Assert
    expect(pickEnglishVoice(voices)?.name).toBe('Albert')
  })

  test('英語が 1 つも無ければ null (lang 指定だけで鳴らす)', () => {
    // Arrange / Act / Assert
    expect(pickEnglishVoice([voice('Kyoko', 'ja-JP')])).toBeNull()
    expect(pickEnglishVoice([])).toBeNull()
  })
})

describe('describeVoice', () => {
  test('声の名前と言語を 1 行にする (診断ログ用)', () => {
    // Arrange / Act / Assert
    expect(describeVoice(voice('Samantha', 'en-US'))).toBe('Samantha/en-US')
  })

  test('声が無ければ lang だけで鳴らすことを書く', () => {
    // Arrange / Act / Assert
    expect(describeVoice(null)).toBe('なし(langのみ)')
  })
})
