import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TTS_GIVEUP_MS,
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

  test('エンジンが抱えている間は横取りしない (二重に読み上げない)', () => {
    // Arrange — iOS は最初の 1 回の立ち上がりが遅いことがある
    const synth = installSpeech([voice('Samantha', 'en-US')])

    // Act — speak は受け付けられ、まだ鳴り始めていない状態
    speak('concise')
    synth.speaking = true
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)

    // Assert
    expect(synth.speak).toHaveBeenCalledOnce()
  })

  test('抱えたまま鳴り始めなければ打ち切って知らせる', () => {
    // Arrange
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
    synth.speaking = true
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert — 押した見た目のまま固まらせない
    expect(onEnd).toHaveBeenCalledWith(false)
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

// 終わり方が多い (1.2 秒のやり直し・8 秒の打ち切り・onend・onerror・
// speak の例外・停止) ので、**知らせが二重に飛ばないこと**をまとめて固定する。
// 二重に飛ぶと「鳴ったのに数秒後に失敗と出る」「鳴っている途中でボタンが
// 止められなくなる」という、実機でしか出ない形の壊れ方になる
describe('終わりの知らせは 1 度だけ (settle once)', () => {
  // speakEnglish の describe と同じ作法 — skipVoice の覚え書きを持ち越さない
  // ように読み込み直し、見張りを進めるために時計も握る
  let speak: typeof speakEnglish
  let stop: typeof stopSpeaking
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const tts = await import('./ttsSpeech')
    speak = tts.speakEnglish
    stop = tts.stopSpeaking
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('声を外したやり直しが鳴ったら、後から失敗を知らせない', () => {
    // Arrange — 1 回目の 8 秒の打ち切りが生き残ると、正しく鳴り終えた
    // 数秒後に「この端末では読み上げできませんでした」が出る
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)
    const retried = synth.speak.mock.calls[1][0] as FakeUtterance
    retried.onstart?.()
    retried.onend?.()
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(true)
  })

  test('やり直した後に 1 回目が遅れて鳴っても、知らせは増えない', () => {
    // Arrange — iOS は speaking / pending が false のまま utterance を
    // 抱えていることがある (この見張りが在る理由)。やり直した後で
    // 1 回目が鳴り出すと、読み上げ中なのにボタンが idle に戻ってしまう
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)
    const first = synth.speak.mock.calls[0][0] as FakeUtterance
    const retried = synth.speak.mock.calls[1][0] as FakeUtterance
    retried.onend?.()
    first.onstart?.()
    first.onend?.()

    // Assert — 1 回目のハンドラは外してある (勝手に知らせに来させない)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(first.onend).toBeNull()
  })

  test('鳴り始める前に止めたら、後から「鳴らなかった」と言わない', () => {
    // Arrange — 鳴っていないので cancel は呼べず (iOS の作法)、onerror も
    // 飛ばない。見張りだけが残るので、止めた数秒後に警告が出ていた
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
    stop()
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert — 止めたのは利用者なので失敗ではない
    expect(synth.cancel).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(true)
  })

  test('打ち切ったら engine からも降ろす (後から鳴り出させない)', () => {
    // Arrange — 抱えたまま鳴り始めない端末。諦めた utterance を残すと、
    // ボタンが idle に戻った後で鳴り出し、そのボタンでは止められなくなる
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
    synth.speaking = true
    vi.advanceTimersByTime(TTS_GIVEUP_MS)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    utterance.onend?.()

    // Assert
    expect(synth.cancel).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(false)
  })

  test('speak が毎回投げても、知らせは 1 度だけ', () => {
    // Arrange — 代入も speak も投げる端末では、失敗までが同期に走る
    const synth = installSpeech([voice('Samantha', 'en-US')])
    synth.speak.mockImplementation(() => {
      throw new Error('speak failed')
    })
    const onEnd = vi.fn()

    // Act
    speak('concise', onEnd)
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(false)
  })

  test('別の語を鳴らすと、前の回は失敗ではなく「止まった」で終える', () => {
    // Arrange — 新しい speak() が cancel で前の声を止めるので、前の行に
    // 警告を出してはいけない (押していない行に警告が残る)
    const synth = installSpeech([voice('Samantha', 'en-US')])
    const onFirst = vi.fn()

    // Act
    speak('concise', onFirst)
    synth.speaking = true
    speak('subtle', vi.fn())
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert
    expect(onFirst).toHaveBeenCalledTimes(1)
    expect(onFirst).toHaveBeenCalledWith(true)
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
