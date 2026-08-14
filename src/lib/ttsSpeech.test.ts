import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TTS_LANG,
  TTS_RATE,
  TTS_START_TIMEOUT_MS,
  pickEnglishVoice,
  speakEnglish,
  stopSpeaking,
} from './ttsSpeech'

// 診断ログはサーバへ送る副作用なので黙らせる (node には Beacon も無い)
vi.mock('./diagLog', () => ({ logDiagEvent: vi.fn() }))

const voice = (name: string, lang: string) =>
  ({ name, lang }) as SpeechSynthesisVoice

// ブラウザの API を差し込むための最小の作り物。vitest は node 環境なので
// speechSynthesis も SpeechSynthesisUtterance も無い
class FakeUtterance {
  lang = ''
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  constructor(public text: string) {}
}

// 声を代入しようとすると投げる端末の作り物。voice は**アクセサ**にする
// (クラスフィールドにすると構築時の初期化で自分の setter を踏む)
class VoiceRejectingUtterance {
  lang = ''
  rate = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  constructor(public text: string) {}
  set voice(_value: SpeechSynthesisVoice | null) {
    throw new TypeError('Failed to convert value to SpeechSynthesisVoice')
  }
  get voice(): SpeechSynthesisVoice | null {
    return null
  }
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
  // 「この端末では声を指定しない」の覚え書きをテスト間で持ち越さないよう、
  // 毎回モジュールを読み込み直す (ocrService.test.ts と同じ作法)。
  // 鳴り始めの見張り (setTimeout) が必ず 1 本走るので時計も握る
  let speak: typeof speakEnglish
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    speak = (await import('./ttsSpeech')).speakEnglish
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('US 英語の声・言語・速さで読み上げる', () => {
    // Arrange
    const synth = installSpeech([
      voice('Kyoko', 'ja-JP'),
      voice('Samantha', 'en-US'),
    ])

    // Act
    const ok = speak('concise')

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
    const ok = speak('concise')

    // Assert
    expect(ok).toBe(true)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.voice).toBeNull()
    expect(utterance.lang).toBe(TTS_LANG)
  })

  test('読み上げ中なら止めて、待たずにその場で読み直す', () => {
    // Arrange — 待ちを挟むと iOS が「操作の中で呼んでいない」と見なして捨てる
    const synth = installSpeech([voice('Samantha', 'en-US')], true)

    // Act
    speak('concise')

    // Assert
    expect(synth.cancel).toHaveBeenCalledOnce()
    expect(synth.speak).toHaveBeenCalledOnce()
  })

  test('読み上げていなければ止めない (iOS で speak が落ちるため)', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])

    // Act
    speak('concise')

    // Assert
    expect(synth.cancel).not.toHaveBeenCalled()
  })

  test('終わったら知らせる', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
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
    speak('concise', onEnd)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    utterance.onerror?.({ error: 'synthesis-failed' })

    // Assert
    expect(onEnd).toHaveBeenCalledOnce()
  })

  test('鳴り始めなければ声を外してもう一度試す', () => {
    // Arrange — 一覧に載っていても実際には鳴らせない声がある (iPhone で発生)
    const synth = installSpeech([voice('Samantha', 'en-US')])

    // Act
    speak('concise')
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)

    // Assert — 2 回目は声を外し、lang だけで OS に選ばせる
    expect(synth.speak).toHaveBeenCalledTimes(2)
    const retried = synth.speak.mock.calls[1][0] as FakeUtterance
    expect(retried.voice).toBeNull()
    expect(retried.lang).toBe(TTS_LANG)
    expect(retried.text).toBe('concise')
  })

  test('鳴り始めていれば試し直さない (二重に読み上げない)', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])

    // Act
    speak('concise')
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    utterance.onstart?.()
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)

    // Assert
    expect(synth.speak).toHaveBeenCalledOnce()
  })

  test('声の代入が投げても、声を外して鳴らす (押しても無反応にしない)', () => {
    // Arrange — 一覧から取った声でも代入で TypeError を出す端末がある
    const synth = installSpeech([voice('Samantha', 'en-US')])
    Object.assign(globalThis, {
      SpeechSynthesisUtterance: VoiceRejectingUtterance,
    })

    // Act
    const ok = speak('concise')

    // Assert — 例外は外に出さず、lang だけで読み上げに進む
    expect(ok).toBe(true)
    expect(synth.speak).toHaveBeenCalledOnce()
    const utterance = synth.speak.mock.calls[0][0] as VoiceRejectingUtterance
    expect(utterance.lang).toBe(TTS_LANG)
    expect(utterance.text).toBe('concise')
  })

  test('speak 自体が投げたら、待たずに声なしで試し直す', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])
    synth.speak.mockImplementationOnce(() => {
      throw new Error('speak failed')
    })

    // Act
    speak('concise')

    // Assert — 見張りの 1.2 秒を待たずに 2 回目へ進む
    expect(synth.speak).toHaveBeenCalledTimes(2)
    expect((synth.speak.mock.calls[1][0] as FakeUtterance).voice).toBeNull()
  })

  test('一度声を外したら、次からは待たずに声なしで鳴らす', () => {
    // Arrange — 毎回 1.2 秒待たせないため、判った時点で覚える
    const synth = installSpeech([voice('Samantha', 'en-US')])
    speak('concise')
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)
    synth.speak.mockClear()

    // Act
    speak('subtle')

    // Assert
    expect(synth.speak).toHaveBeenCalledOnce()
    expect((synth.speak.mock.calls[0][0] as FakeUtterance).voice).toBeNull()
  })

  test('声を外しても鳴らなければ知らせる (押した見た目を戻す)', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)

    // Assert
    expect(synth.speak).toHaveBeenCalledTimes(2)
    expect(onEnd).toHaveBeenCalledOnce()
  })

  test('読み上げに対応していない端末では false を返す', () => {
    // Arrange — speechSynthesis を入れないまま呼ぶ

    // Act / Assert
    expect(speak('concise')).toBe(false)
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
