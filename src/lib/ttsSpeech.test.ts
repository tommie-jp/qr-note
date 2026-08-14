import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  RESPEAK_DELAY_MS,
  TTS_LANG,
  TTS_RATE,
  pickEnglishVoice,
  speakEnglish,
  stopSpeaking,
} from './ttsSpeech'

const voice = (name: string, lang: string) =>
  ({ name, lang }) as SpeechSynthesisVoice

// ブラウザの API を差し込むための最小の作り物。vitest は node 環境なので
// speechSynthesis も SpeechSynthesisUtterance も無い
class FakeUtterance {
  lang = ''
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}

interface FakeSynth {
  speaking: boolean
  pending: boolean
  cancel: ReturnType<typeof vi.fn>
  speak: ReturnType<typeof vi.fn>
  getVoices: () => SpeechSynthesisVoice[]
}

function installSpeech(
  voices: SpeechSynthesisVoice[],
  speaking = false,
): FakeSynth {
  const synth: FakeSynth = {
    speaking,
    pending: false,
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: () => voices,
  }
  Object.assign(globalThis, {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
  })
  return synth
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'speechSynthesis')
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')
})

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

describe('speakEnglish', () => {
  test('US 英語の声・言語・速さで読み上げる', () => {
    // Arrange
    const synth = installSpeech([
      voice('Kyoko', 'ja-JP'),
      voice('Samantha', 'en-US'),
    ])

    // Act
    const ok = speakEnglish('concise')

    // Assert
    expect(ok).toBe(true)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.text).toBe('concise')
    expect(utterance.lang).toBe(TTS_LANG)
    expect(utterance.rate).toBe(TTS_RATE)
    expect(utterance.voice?.name).toBe('Samantha')
  })

  test('声の一覧が空でも lang だけで鳴らす (iOS の初回)', () => {
    // Arrange — getVoices() は初回に空を返すことがある
    const synth = installSpeech([])

    // Act
    const ok = speakEnglish('concise')

    // Assert
    expect(ok).toBe(true)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.voice).toBeNull()
    expect(utterance.lang).toBe(TTS_LANG)
  })

  test('読み上げ中なら止めて、ひと呼吸置いてから読み直す', () => {
    // Arrange — cancel() の直後に speak() すると無音になる端末がある
    vi.useFakeTimers()
    const synth = installSpeech([voice('Samantha', 'en-US')], true)

    // Act
    speakEnglish('concise')

    // Assert
    expect(synth.cancel).toHaveBeenCalledOnce()
    expect(synth.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(RESPEAK_DELAY_MS)
    expect(synth.speak).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  test('読み上げていなければ止めない (iOS で speak が落ちるため)', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])

    // Act
    speakEnglish('concise')

    // Assert
    expect(synth.cancel).not.toHaveBeenCalled()
  })

  test('終わったら知らせる', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speakEnglish('concise', onEnd)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    utterance.onend?.()

    // Assert
    expect(onEnd).toHaveBeenCalledOnce()
  })

  test('失敗しても知らせる (押しっぱなしの見た目で固まらせない)', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speakEnglish('concise', onEnd)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    utterance.onerror?.()

    // Assert
    expect(onEnd).toHaveBeenCalledOnce()
  })

  test('読み上げに対応していない端末では false を返す', () => {
    // Arrange — speechSynthesis を入れないまま呼ぶ

    // Act / Assert
    expect(speakEnglish('concise')).toBe(false)
  })
})

describe('stopSpeaking', () => {
  test('読み上げ中なら止める', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')], true)

    // Act
    stopSpeaking()

    // Assert
    expect(synth.cancel).toHaveBeenCalledOnce()
  })

  test('対応していない端末で呼んでも落ちない', () => {
    // Arrange / Act / Assert
    expect(() => stopSpeaking()).not.toThrow()
  })
})
