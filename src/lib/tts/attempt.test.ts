import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  FakeUtterance,
  VoiceRejectingUtterance,
  installSpeech,
  uninstallSpeech,
  voice,
} from '@/test/fakeSpeech'
import {
  cancelIfBusy,
  speakOnce,
  speechApi,
  type AttemptHandlers,
  type SpeechApi,
  type TtsEndHandler,
} from './attempt'
import {
  TTS_GIVEUP_MS,
  TTS_LANG,
  TTS_RATE,
  TTS_START_TIMEOUT_MS,
} from './config'

// 診断ログはサーバへ送る副作用なので黙らせる (node には Beacon も無い)
vi.mock('@/lib/diagLog', () => ({ logDiagEvent: vi.fn() }))

// 1 回ぶんの試行だけを見る。やり直し・settle once・声の覚え書きは
// セッション側 (speak.test.ts) で固定してあるので、ここでは知らせる口を
// どの条件で何回呼ぶかを確かめる
function handlers() {
  return {
    settle: vi.fn<TtsEndHandler>(),
    onNotStarted: vi.fn<() => void>(),
    onVoiceRejected: vi.fn<() => void>(),
  } satisfies AttemptHandlers
}

// installSpeech で差し込んだ API を、本体と同じ取り出し口から受け取る
function installedApi(): SpeechApi {
  const api = speechApi()
  if (api === null) {
    throw new Error('speech API is not installed')
  }
  return api
}

// cancelIfBusy に渡すだけの状態つき synth
function synthIn(state: { speaking: boolean; pending: boolean }) {
  const cancel = vi.fn()
  return { synth: { ...state, cancel } as unknown as SpeechSynthesis, cancel }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  uninstallSpeech()
})

describe('speechApi', () => {
  test('speechSynthesis の無い環境では null (サーバ描画で落とさない)', () => {
    // Arrange — 何も差し込まない

    // Act / Assert
    expect(speechApi()).toBeNull()
  })
})

describe('cancelIfBusy', () => {
  test('鳴っているか抱えているときだけ止める (iOS で直後の speak を巻き込まない)', () => {
    // Arrange
    const idle = synthIn({ speaking: false, pending: false })
    const speaking = synthIn({ speaking: true, pending: false })
    const pending = synthIn({ speaking: false, pending: true })

    // Act
    cancelIfBusy(idle.synth)
    cancelIfBusy(speaking.synth)
    cancelIfBusy(pending.synth)

    // Assert
    expect(idle.cancel).not.toHaveBeenCalled()
    expect(speaking.cancel).toHaveBeenCalledOnce()
    expect(pending.cancel).toHaveBeenCalledOnce()
  })
})

describe('speakOnce', () => {
  test('言語・速さ・声を載せて、その場で speak する', () => {
    // Arrange
    const synth = installSpeech([])
    const samantha = voice('Samantha', 'en-US')

    // Act
    speakOnce(installedApi(), 'concise', samantha, handlers())

    // Assert
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.text).toBe('concise')
    expect(utterance.lang).toBe(TTS_LANG)
    expect(utterance.rate).toBe(TTS_RATE)
    expect(utterance.voice).toBe(samantha)
  })

  test('声の代入が投げたら知らせて、声なしで speak まで進む', () => {
    // Arrange
    const synth = installSpeech([])
    Object.assign(globalThis, { SpeechSynthesisUtterance: VoiceRejectingUtterance })
    const on = handlers()

    // Act
    const run = () =>
      speakOnce(installedApi(), 'concise', voice('Samantha', 'en-US'), on)

    // Assert
    expect(run).not.toThrow()
    expect(on.onVoiceRejected).toHaveBeenCalledOnce()
    expect(synth.speak).toHaveBeenCalledOnce()
  })

  test('声を渡さなければ代入しない (断られた知らせも出ない)', () => {
    // Arrange
    const synth = installSpeech([])
    Object.assign(globalThis, { SpeechSynthesisUtterance: VoiceRejectingUtterance })
    const on = handlers()

    // Act
    speakOnce(installedApi(), 'concise', null, on)

    // Assert
    expect(on.onVoiceRejected).not.toHaveBeenCalled()
    expect(synth.speak).toHaveBeenCalledOnce()
  })

  test('黙ったまま待ち時間を過ぎたら「鳴り始めない」を知らせる', () => {
    // Arrange
    installSpeech([])
    const on = handlers()

    // Act
    speakOnce(installedApi(), 'concise', null, on)
    vi.advanceTimersByTime(TTS_START_TIMEOUT_MS)

    // Assert
    expect(on.onNotStarted).toHaveBeenCalledOnce()
    expect(on.settle).not.toHaveBeenCalled()
  })

  test('エンジンが抱えていれば待ち時間を過ぎても横取りせず、打ち切りで降ろす', () => {
    // Arrange
    const synth = installSpeech([])
    const on = handlers()

    // Act
    speakOnce(installedApi(), 'concise', null, on)
    synth.speaking = true
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert
    expect(on.onNotStarted).not.toHaveBeenCalled()
    expect(synth.cancel).toHaveBeenCalledOnce()
    expect(on.settle).toHaveBeenCalledTimes(1)
    expect(on.settle).toHaveBeenCalledWith(false)
  })

  test('止めたときの error は失敗ではなく「止まった」で知らせる', () => {
    // Arrange
    const synth = installSpeech([])
    const stopped = handlers()
    const failed = handlers()

    // Act
    speakOnce(installedApi(), 'a', null, stopped)
    speakOnce(installedApi(), 'b', null, failed)
    const [first, second] = synth.speak.mock.calls.map((call) => call[0] as FakeUtterance)
    first.onerror?.({ error: 'interrupted' })
    second.onerror?.({ error: 'synthesis-failed' })

    // Assert
    expect(stopped.settle).toHaveBeenCalledTimes(1)
    expect(stopped.settle).toHaveBeenCalledWith(true)
    expect(failed.settle).toHaveBeenCalledTimes(1)
    expect(failed.settle).toHaveBeenCalledWith(false)
  })

  test('abandon で畳んだ試行は見張りもハンドラも残さない', () => {
    // Arrange
    const synth = installSpeech([])
    const on = handlers()
    const attempt = speakOnce(installedApi(), 'concise', null, on)
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance

    // Act
    attempt.abandon()
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert
    expect(utterance.onstart).toBeNull()
    expect(utterance.onend).toBeNull()
    expect(utterance.onerror).toBeNull()
    expect(on.onNotStarted).not.toHaveBeenCalled()
    expect(on.settle).not.toHaveBeenCalled()
  })

  test('speak 自体が投げたら、見張りを待たずにその場で知らせる', () => {
    // Arrange
    const synth = installSpeech([])
    synth.speak.mockImplementationOnce(() => {
      throw new Error('speak failed')
    })
    const on = handlers()

    // Act
    speakOnce(installedApi(), 'concise', null, on)
    vi.advanceTimersByTime(TTS_GIVEUP_MS)

    // Assert — 畳んであるので見張りからの二度目は来ない
    expect(on.onNotStarted).toHaveBeenCalledOnce()
    expect(on.settle).not.toHaveBeenCalled()
  })
})
