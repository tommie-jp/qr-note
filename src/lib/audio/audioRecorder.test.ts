import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MAX_IMAGE_BYTES } from '../uploads/limits'
import {
  AUDIO_BITS_PER_SECOND,
  AudioCaptureError,
  AudioRecorder,
  extensionFor,
  MAX_RECORDING_MS,
  mapCaptureError,
  pickMimeType,
  recordingAltText,
  recordingFileName,
} from './audioRecorder'

describe('pickMimeType', () => {
  const original = globalThis.MediaRecorder

  afterEach(() => {
    globalThis.MediaRecorder = original
  })

  test('MediaRecorder が無い環境では undefined', () => {
    // @ts-expect-error テストのため global を消す
    delete globalThis.MediaRecorder
    expect(pickMimeType()).toBeUndefined()
  })

  // 実ブラウザの対応状況を写したモック。Playwright で実測した値
  // (audioRecorder.ts の MIME_CANDIDATES のコメントの表)
  const supportLike = (browser: 'safari' | 'chrome' | 'firefox') => (type: string) => {
    if (type.startsWith('audio/webm')) {
      return true // 3 つとも webm 録音に対応する
    }
    if (type === 'audio/mp4;codecs=mp4a.40.2') {
      return browser === 'safari' // AAC を明示した形は Safari だけ
    }
    return browser !== 'firefox' // 素の audio/mp4 は Chrome も対応と答える
  }

  const useMediaRecorder = (isTypeSupported: (type: string) => boolean) => {
    globalThis.MediaRecorder = { isTypeSupported } as unknown as typeof MediaRecorder
  }

  // ここが今回の肝。Safari も webm を録れるようになったが、その再生が
  // 不安定なので mp4/AAC へ寄せる
  test('Safari は webm も録れるが mp4/AAC を選ぶ', () => {
    useMediaRecorder(supportLike('safari'))
    expect(pickMimeType()).toBe('audio/mp4;codecs=mp4a.40.2')
  })

  // 素の audio/mp4 は Chrome も対応と答えるため、順番を間違えると
  // Chrome まで mp4 になる。webm のままであることを固定する
  test('Chrome は webm/opus のまま (mp4 に流れない)', () => {
    useMediaRecorder(supportLike('chrome'))
    expect(pickMimeType()).toBe('audio/webm;codecs=opus')
  })

  test('Firefox は webm/opus のまま', () => {
    useMediaRecorder(supportLike('firefox'))
    expect(pickMimeType()).toBe('audio/webm;codecs=opus')
  })

  test('webm しか出せない環境でも選べる', () => {
    useMediaRecorder((type) => type === 'audio/webm')
    expect(pickMimeType()).toBe('audio/webm')
  })
})

test('録音 mime を拡張子に写す', () => {
  expect(extensionFor('audio/webm;codecs=opus')).toBe('webm')
  expect(extensionFor('audio/webm')).toBe('webm')
  expect(extensionFor('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
  expect(extensionFor('audio/mp4')).toBe('m4a')
})

test('録音日時を alt とファイル名に整形する', () => {
  const at = new Date(2026, 6, 20, 14, 3, 9) // 2026-07-20 14:03:09 (ローカル時刻)
  expect(recordingAltText(at)).toBe('録音 2026-07-20 14:03:09')
  expect(recordingFileName(at, 'webm')).toBe('recording-20260720-140309.webm')
})

test('alt に画像記法を壊す文字が入らない', () => {
  const alt = recordingAltText(new Date(2026, 0, 1, 0, 0, 0))
  expect(alt).not.toMatch(/[[\]\r\n]/)
})

// ビットレートと自動停止の長さは、アップロード上限と地続きの約束事。
// どれか 1 つを動かしたときにここで気づけるようにする
test('自動停止までの録音がアップロード上限に収まる', () => {
  const bytesPerSecond = AUDIO_BITS_PER_SECOND / 8
  const maxBytes = bytesPerSecond * (MAX_RECORDING_MS / 1000)
  expect(maxBytes).toBeLessThan(MAX_IMAGE_BYTES)
})

type MockRecorder = {
  state: 'inactive' | 'recording'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

describe('AudioRecorder', () => {
  const originalRecorder = globalThis.MediaRecorder
  const originalMediaDevices = navigator.mediaDevices

  let instance: MockRecorder
  let track: { stop: ReturnType<typeof vi.fn> }
  let constructorOptions: MediaRecorderOptions | undefined

  const setMediaDevices = (getUserMedia: () => Promise<unknown>) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(getUserMedia) },
      configurable: true,
    })
  }

  beforeEach(() => {
    constructorOptions = undefined
    instance = {
      state: 'inactive',
      mimeType: 'audio/webm;codecs=opus',
      ondataavailable: null,
      onstop: null,
      start: vi.fn(() => {
        instance.state = 'recording'
      }),
      stop: vi.fn(() => {
        instance.state = 'inactive'
        instance.ondataavailable?.({
          data: new Blob(['chunk'], { type: instance.mimeType }),
        })
        instance.onstop?.()
      }),
    }

    function MediaRecorderCtor(this: unknown, _stream: unknown, options?: MediaRecorderOptions) {
      constructorOptions = options
      return instance
    }
    MediaRecorderCtor.isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
    globalThis.MediaRecorder = MediaRecorderCtor as unknown as typeof MediaRecorder

    track = { stop: vi.fn() }
    setMediaDevices(async () => ({ getTracks: () => [track] }))
  })

  afterEach(() => {
    globalThis.MediaRecorder = originalRecorder
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    })
  })

  test('録音 → 停止でアップロードできる File を返す', async () => {
    const recorder = new AudioRecorder()
    await recorder.start()
    expect(recorder.isRecording).toBe(true)

    const result = await recorder.stop()
    // MemoEditorInner の isAudioFile が audio/ で拾えること
    expect(result.file.type).toBe('audio/webm;codecs=opus')
    expect(result.file.name).toMatch(/^recording-\d{8}-\d{6}\.webm$/)
    expect(result.file.size).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(recorder.isRecording).toBe(false)
  })

  // Safari の録音は audio/mp4。moov の並べ替えはサーバ側でやるので、
  // ここでは中身に触らず .m4a として渡すことだけを確かめる
  test('Safari の録音は中身をそのまま .m4a として渡す', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    instance.mimeType = 'audio/mp4'
    instance.stop = vi.fn(() => {
      instance.state = 'inactive'
      instance.ondataavailable?.({
        data: new Blob([original], { type: 'audio/mp4' }),
      })
      instance.onstop?.()
    })

    const recorder = new AudioRecorder()
    await recorder.start()
    const result = await recorder.stop()

    expect(result.file.name).toMatch(/\.m4a$/)
    expect(result.file.type).toBe('audio/mp4')
    expect(Array.from(new Uint8Array(await result.file.arrayBuffer()))).toEqual(
      Array.from(original),
    )
  })

  test('ビットレートを明示して録音する (ブラウザ任せにしない)', async () => {
    const recorder = new AudioRecorder()
    await recorder.start()
    expect(constructorOptions?.audioBitsPerSecond).toBe(AUDIO_BITS_PER_SECOND)
    await recorder.stop()
  })

  test('停止するとマイクを離す', async () => {
    const recorder = new AudioRecorder()
    await recorder.start()
    expect(track.stop).not.toHaveBeenCalled()
    await recorder.stop()
    expect(track.stop).toHaveBeenCalled()
  })

  test('中断してもマイクを離す (画面離脱)', async () => {
    const recorder = new AudioRecorder()
    await recorder.start()
    recorder.cancel()
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isRecording).toBe(false)
  })

  test('MediaRecorder の生成に失敗してもマイクを離す', async () => {
    globalThis.MediaRecorder = Object.assign(
      function failing() {
        throw new Error('生成できません')
      },
      { isTypeSupported: () => true },
    ) as unknown as typeof MediaRecorder

    const recorder = new AudioRecorder()
    await expect(recorder.start()).rejects.toBeInstanceOf(AudioCaptureError)
    expect(track.stop).toHaveBeenCalled()
  })

  // recorder.start() は生成の後に呼ばれるので、ここで投げられると
  // stream がまだ this.stream に入っていない。誰も track.stop() を
  // 呼べなくなるため、start() 自身が離す必要がある
  test('MediaRecorder.start() が投げてもマイクを離す', async () => {
    instance.start = vi.fn(() => {
      throw new Error('InvalidStateError')
    })
    const recorder = new AudioRecorder()
    await expect(recorder.start()).rejects.toBeInstanceOf(AudioCaptureError)
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isRecording).toBe(false)
  })

  // OS にマイクを取り上げられると MediaRecorder が勝手に inactive になり、
  // stop() が投げる。後始末を飛ばすと「既に録音中です」で二度と録音できなくなる
  test('停止が失敗しても後始末して次の録音を妨げない', async () => {
    const recorder = new AudioRecorder()
    await recorder.start()
    instance.stop = vi.fn(() => {
      throw new Error('InvalidStateError')
    })

    await expect(recorder.stop()).rejects.toThrow('InvalidStateError')
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isRecording).toBe(false)

    // 掴んだままにしていないので、録音し直せる
    instance.stop = vi.fn(() => {
      instance.state = 'inactive'
      instance.ondataavailable?.({ data: new Blob(['x'], { type: instance.mimeType }) })
      instance.onstop?.()
    })
    await expect(recorder.start()).resolves.toBeUndefined()
  })

  test('録音していないのに停止すると弾く', async () => {
    await expect(new AudioRecorder().stop()).rejects.toThrow('録音中ではありません')
  })

  test('二重に開始すると弾く', async () => {
    const recorder = new AudioRecorder()
    await recorder.start()
    await expect(recorder.start()).rejects.toThrow('既に録音中です')
  })

  test('iOS の AudioSession エラーは対処法つきで返す', async () => {
    setMediaDevices(async () => {
      throw new Error('AudioSession category is not compatible with audio capture.')
    })
    const recorder = new AudioRecorder()
    await expect(recorder.start()).rejects.toBeInstanceOf(AudioCaptureError)
    await expect(recorder.start()).rejects.toThrow(/iOS Safari/)
  })
})

describe('mapCaptureError', () => {
  test('AudioSession の文言は iOS 向けの案内にする', () => {
    const mapped = mapCaptureError(
      new Error('AudioSession category is not compatible with audio capture.'),
    )
    expect(mapped).toBeInstanceOf(AudioCaptureError)
    expect(mapped.message).toMatch(/iOS Safari/)
  })

  test('NotAllowedError はマイク許可の案内にする', () => {
    const e = new Error('Permission denied')
    e.name = 'NotAllowedError'
    expect(mapCaptureError(e).message).toMatch(/マイクの利用が許可/)
  })

  test('NotFoundError はマイク未検出の案内にする', () => {
    const e = new Error('no device')
    e.name = 'NotFoundError'
    expect(mapCaptureError(e).message).toMatch(/マイクが見つかりません/)
  })

  test('AudioCaptureError はそのまま通す', () => {
    const original = new AudioCaptureError('original')
    expect(mapCaptureError(original)).toBe(original)
  })
})
