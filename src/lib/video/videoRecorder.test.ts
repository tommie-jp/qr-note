import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MAX_VIDEO_BYTES } from '../uploads'
import {
  AUDIO_BITS_PER_SECOND,
  estimatedBytes,
  extensionFor,
  MAX_RECORDING_MS,
  mapCaptureError,
  pickMimeType,
  recordingAltText,
  recordingFileName,
  SIZE_STOP_MS,
  TOTAL_BITS_PER_SECOND,
  VIDEO_BITS_PER_SECOND,
  VideoCaptureError,
  VideoRecorder,
} from './videoRecorder'

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

  // 実ブラウザの対応状況を写したモック。Safari だけ codecs 明示の mp4 に答える
  const supportLike = (browser: 'safari' | 'chrome' | 'firefox') => (type: string) => {
    if (type.startsWith('video/webm')) {
      // Safari は webm 録画に対応しないので webm 系は非対応にする
      return browser !== 'safari'
    }
    if (type === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2') {
      return browser === 'safari'
    }
    return browser !== 'firefox'
  }

  const useMediaRecorder = (isTypeSupported: (type: string) => boolean) => {
    globalThis.MediaRecorder = { isTypeSupported } as unknown as typeof MediaRecorder
  }

  test('Safari は mp4/H.264+AAC を選ぶ', () => {
    useMediaRecorder(supportLike('safari'))
    expect(pickMimeType()).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
  })

  test('Chrome は webm/VP9 のまま (mp4 に流れない)', () => {
    useMediaRecorder(supportLike('chrome'))
    expect(pickMimeType()).toBe('video/webm;codecs=vp9,opus')
  })

  test('Firefox は webm/VP8 系を選ぶ', () => {
    useMediaRecorder((type) => type === 'video/webm;codecs=vp8,opus' || type === 'video/webm')
    expect(pickMimeType()).toBe('video/webm;codecs=vp8,opus')
  })

  test('webm しか出せない環境でも選べる', () => {
    useMediaRecorder((type) => type === 'video/webm')
    expect(pickMimeType()).toBe('video/webm')
  })
})

test('録画 mime を拡張子に写す', () => {
  expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm')
  expect(extensionFor('video/webm')).toBe('webm')
  expect(extensionFor('video/mp4;codecs=avc1.42E01E,mp4a.40.2')).toBe('mp4')
  expect(extensionFor('video/mp4')).toBe('mp4')
})

test('録画日時を alt とファイル名に整形する', () => {
  const at = new Date(2026, 6, 20, 14, 3, 9) // 2026-07-20 14:03:09 (ローカル時刻)
  expect(recordingAltText(at)).toBe('録画 2026-07-20 14:03:09')
  expect(recordingFileName(at, 'mp4')).toBe('video-20260720-140309.mp4')
})

test('alt に画像記法を壊す文字が入らない', () => {
  const alt = recordingAltText(new Date(2026, 0, 1, 0, 0, 0))
  expect(alt).not.toMatch(/[[\]\r\n]/)
})

// ビットレートと自動停止 (時間・サイズ) は、アップロード上限と地続きの約束事。
// どれか 1 つを動かしたときにここで気づけるようにする。
test('自動停止までの録画がアップロード上限に収まる', () => {
  const maxBytesByTime = estimatedBytes(MAX_RECORDING_MS)
  expect(maxBytesByTime).toBeLessThan(MAX_VIDEO_BYTES)
  // 3 分 (時間) がサイズ上限より先に来る想定 (24MB < 27MB の 9 割手前)
  expect(MAX_RECORDING_MS).toBeLessThan(SIZE_STOP_MS)
  // 推定は合計ビットレートで計算する
  expect(TOTAL_BITS_PER_SECOND).toBe(VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND)
})

type MockRecorder = {
  state: 'inactive' | 'recording'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

describe('VideoRecorder', () => {
  const originalRecorder = globalThis.MediaRecorder
  const originalMediaDevices = navigator.mediaDevices

  let instance: MockRecorder
  let track: { stop: ReturnType<typeof vi.fn> }
  let constructorOptions: MediaRecorderOptions | undefined
  let getUserMediaMock: ReturnType<typeof vi.fn>

  // open() → record() をまとめて呼ぶ (旧 start() 相当。プレビューを挟まない経路)
  const startRecording = async (recorder: VideoRecorder) => {
    await recorder.open()
    recorder.record()
  }

  // getUserMedia は制約を控えるようにし、既定は超広角を持たない端末 (通常カメラ)
  const setMediaDevices = (options?: {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<unknown>
    enumerateDevices?: () => Promise<MediaDeviceInfo[]>
  }) => {
    getUserMediaMock = vi.fn(
      options?.getUserMedia ??
        (async () => ({
          getTracks: () => [track],
          getVideoTracks: () => [track],
        })),
    )
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: getUserMediaMock,
        enumerateDevices:
          options?.enumerateDevices ?? (async () => [] as MediaDeviceInfo[]),
      },
      configurable: true,
    })
  }

  beforeEach(() => {
    constructorOptions = undefined
    instance = {
      state: 'inactive',
      mimeType: 'video/webm;codecs=vp9,opus',
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
    MediaRecorderCtor.isTypeSupported = (type: string) => type === 'video/webm;codecs=vp9,opus'
    globalThis.MediaRecorder = MediaRecorderCtor as unknown as typeof MediaRecorder

    track = { stop: vi.fn() }
    setMediaDevices()
  })

  afterEach(() => {
    globalThis.MediaRecorder = originalRecorder
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    })
  })

  test('open はプレビューを出すが録画はしない', async () => {
    const recorder = new VideoRecorder()
    await recorder.open()
    expect(recorder.isOpen).toBe(true)
    expect(recorder.isRecording).toBe(false)
    expect(recorder.stream).not.toBeNull()
    // まだ録画していないので MediaRecorder は生成されていない
    expect(constructorOptions).toBeUndefined()
  })

  test('録画 → 停止でアップロードできる File を返す', async () => {
    const recorder = new VideoRecorder()
    await startRecording(recorder)
    expect(recorder.isRecording).toBe(true)
    // ライブプレビュー用の stream が取れる
    expect(recorder.stream).not.toBeNull()

    const result = await recorder.stop()
    // MemoEditorInner の isVideoFile が video/ で拾えること
    expect(result.file.type).toBe('video/webm;codecs=vp9,opus')
    expect(result.file.name).toMatch(/^video-\d{8}-\d{6}\.webm$/)
    expect(result.file.size).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(recorder.isRecording).toBe(false)
    expect(recorder.stream).toBeNull()
  })

  // Safari の録画は video/mp4。moov の並べ替えはサーバ側でやるので、
  // ここでは中身に触らず .mp4 として渡すことだけを確かめる
  test('Safari の録画は中身をそのまま .mp4 として渡す', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    instance.mimeType = 'video/mp4'
    instance.stop = vi.fn(() => {
      instance.state = 'inactive'
      instance.ondataavailable?.({
        data: new Blob([original], { type: 'video/mp4' }),
      })
      instance.onstop?.()
    })

    const recorder = new VideoRecorder()
    await startRecording(recorder)
    const result = await recorder.stop()

    expect(result.file.name).toMatch(/\.mp4$/)
    expect(result.file.type).toBe('video/mp4')
    expect(Array.from(new Uint8Array(await result.file.arrayBuffer()))).toEqual(
      Array.from(original),
    )
  })

  test('映像・音声のビットレートを明示して録画する', async () => {
    const recorder = new VideoRecorder()
    await startRecording(recorder)
    expect(constructorOptions?.videoBitsPerSecond).toBe(VIDEO_BITS_PER_SECOND)
    expect(constructorOptions?.audioBitsPerSecond).toBe(AUDIO_BITS_PER_SECOND)
    await recorder.stop()
  })

  test('停止するとカメラ・マイクを離す', async () => {
    const recorder = new VideoRecorder()
    await startRecording(recorder)
    expect(track.stop).not.toHaveBeenCalled()
    await recorder.stop()
    expect(track.stop).toHaveBeenCalled()
  })

  test('プレビューを取り消すとカメラを離す (録画前)', async () => {
    const recorder = new VideoRecorder()
    await recorder.open()
    expect(recorder.isOpen).toBe(true)
    recorder.cancel()
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isOpen).toBe(false)
  })

  test('中断してもカメラを離す (画面離脱)', async () => {
    const recorder = new VideoRecorder()
    await startRecording(recorder)
    recorder.cancel()
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isRecording).toBe(false)
  })

  test('MediaRecorder の生成に失敗してもカメラを離す', async () => {
    globalThis.MediaRecorder = Object.assign(
      function failing() {
        throw new Error('生成できません')
      },
      { isTypeSupported: () => true },
    ) as unknown as typeof MediaRecorder

    const recorder = new VideoRecorder()
    await recorder.open()
    expect(() => recorder.record()).toThrow(VideoCaptureError)
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isOpen).toBe(false)
  })

  test('MediaRecorder.start() が投げてもカメラを離す', async () => {
    instance.start = vi.fn(() => {
      throw new Error('InvalidStateError')
    })
    const recorder = new VideoRecorder()
    await recorder.open()
    expect(() => recorder.record()).toThrow(VideoCaptureError)
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isRecording).toBe(false)
  })

  test('停止が失敗しても後始末して次の録画を妨げない', async () => {
    const recorder = new VideoRecorder()
    await startRecording(recorder)
    instance.stop = vi.fn(() => {
      throw new Error('InvalidStateError')
    })

    await expect(recorder.stop()).rejects.toThrow('InvalidStateError')
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.isRecording).toBe(false)
    expect(recorder.isOpen).toBe(false)

    instance.stop = vi.fn(() => {
      instance.state = 'inactive'
      instance.ondataavailable?.({ data: new Blob(['x'], { type: instance.mimeType }) })
      instance.onstop?.()
    })
    await expect(startRecording(recorder)).resolves.toBeUndefined()
  })

  test('録画していないのに停止すると弾く', async () => {
    await expect(new VideoRecorder().stop()).rejects.toThrow('録画中ではありません')
  })

  test('カメラを開かずに record すると弾く', () => {
    expect(() => new VideoRecorder().record()).toThrow('カメラを開いていません')
  })

  test('カメラを二重に開くと弾く', async () => {
    const recorder = new VideoRecorder()
    await recorder.open()
    await expect(recorder.open()).rejects.toThrow('既にカメラを開いています')
  })

  // 近接 (超広角) 選択。iOS の enumerateDevices に背面超広角がある想定
  describe('近接フォーカス (超広角)', () => {
    const ultraWideDevices = async () =>
      [
        { kind: 'videoinput', label: 'Back Camera', deviceId: 'wide' },
        { kind: 'videoinput', label: 'Back Ultra Wide Camera', deviceId: 'ultra' },
      ] as MediaDeviceInfo[]

    test('近接で開くと超広角 deviceId を名指しで gUM する', async () => {
      let usedConstraints: MediaStreamConstraints | undefined
      setMediaDevices({
        enumerateDevices: ultraWideDevices,
        getUserMedia: async (constraints) => {
          usedConstraints = constraints
          return { getVideoTracks: () => [], getTracks: () => [track] }
        },
      })
      const recorder = new VideoRecorder()
      await recorder.open(true)
      expect(recorder.nearFocus).toBe(true)
      const video = usedConstraints?.video as MediaTrackConstraints
      expect(video.deviceId).toEqual({ exact: 'ultra' })
      // iOS が deviceId を前面に誤解決しても開かせないよう exact で固定する
      // (誤解決時は OverconstrainedError → 通常背面フォールバック)
      expect(video.facingMode).toEqual({ exact: 'environment' })
    })

    test('超広角の gUM が拒まれたら通常背面へフォールバックする', async () => {
      const constraints: MediaStreamConstraints[] = []
      setMediaDevices({
        enumerateDevices: ultraWideDevices,
        getUserMedia: async (c) => {
          constraints.push(c)
          const video = c.video as MediaTrackConstraints
          if (video.deviceId) {
            throw new Error('OverconstrainedError') // 前面への誤解決を exact が弾いた想定
          }
          return { getVideoTracks: () => [], getTracks: () => [track] }
        },
      })
      const recorder = new VideoRecorder()
      await recorder.open(true)
      // 開けてはいるが近接ではない (ボタンは OFF 表示になる)
      expect(recorder.isOpen).toBe(true)
      expect(recorder.nearFocus).toBe(false)
      const last = constraints.at(-1)?.video as MediaTrackConstraints
      expect(last.facingMode).toBe('environment')
      expect(last.deviceId).toBeUndefined()
    })

    test('exact も無視して前面で開いたら、捨てて通常背面で開き直す', async () => {
      const frontTrack = {
        stop: vi.fn(),
        getSettings: () => ({ facingMode: 'user' }),
      }
      const backTrack = { stop: vi.fn() }
      setMediaDevices({
        enumerateDevices: ultraWideDevices,
        getUserMedia: async (c) => {
          const video = c.video as MediaTrackConstraints
          if (video.deviceId) {
            // iOS の誤解決を再現: 名指ししたのに前面カメラが返る
            return {
              getVideoTracks: () => [frontTrack],
              getTracks: () => [frontTrack],
            }
          }
          return {
            getVideoTracks: () => [backTrack],
            getTracks: () => [backTrack],
          }
        },
      })
      const recorder = new VideoRecorder()
      await recorder.open(true)
      expect(frontTrack.stop).toHaveBeenCalled() // 前面ストリームは即捨てる
      expect(recorder.isOpen).toBe(true)
      expect(recorder.nearFocus).toBe(false)
    })

    test('切替時は open で控えた deviceId を使い、再列挙しない', async () => {
      const enumerateDevices = vi.fn(ultraWideDevices)
      setMediaDevices({
        enumerateDevices,
        getUserMedia: async () => ({
          getVideoTracks: () => [],
          getTracks: () => [track],
        }),
      })
      const recorder = new VideoRecorder()
      await recorder.open()
      const callsAfterOpen = enumerateDevices.mock.calls.length
      // トラックを止めた後の enumerateDevices はラベルが消えることがあるので、
      // 切替はキャッシュで賄う (41-QR-search/docs/16)
      await recorder.switchNearFocus(true)
      expect(recorder.nearFocus).toBe(true)
      expect(enumerateDevices.mock.calls.length).toBe(callsAfterOpen)
    })

    test('open すると hasUltraWide で近接可否が判る', async () => {
      setMediaDevices({
        enumerateDevices: ultraWideDevices,
        getUserMedia: async () => ({
          getVideoTracks: () => [],
          getTracks: () => [track],
        }),
      })
      const recorder = new VideoRecorder()
      expect(recorder.hasUltraWide).toBe(false) // open 前は判らない
      await recorder.open()
      expect(recorder.hasUltraWide).toBe(true)
    })

    test('超広角が無ければ通常カメラで開き nearFocus は false', async () => {
      let usedConstraints: MediaStreamConstraints | undefined
      setMediaDevices({
        // enumerateDevices は既定 (空配列) のまま超広角なし
        getUserMedia: async (constraints) => {
          usedConstraints = constraints
          return { getVideoTracks: () => [track], getTracks: () => [track] }
        },
      })
      const recorder = new VideoRecorder()
      await recorder.open(true)
      expect(recorder.nearFocus).toBe(false)
      const video = usedConstraints?.video as MediaTrackConstraints
      expect(video.facingMode).toBe('environment')
      expect(video.deviceId).toBeUndefined()
    })

    test('プレビュー中は近接へ切り替えられる (旧トラックを先に止める)', async () => {
      const firstTrack = { stop: vi.fn() }
      const secondTrack = { stop: vi.fn() }
      let call = 0
      setMediaDevices({
        enumerateDevices: ultraWideDevices,
        getUserMedia: async () => ({
          getVideoTracks: () => [],
          getTracks: () => [call++ === 0 ? firstTrack : secondTrack],
        }),
      })
      const recorder = new VideoRecorder()
      await recorder.open()
      expect(recorder.nearFocus).toBe(false)
      await recorder.switchNearFocus(true)
      expect(firstTrack.stop).toHaveBeenCalled() // 先に旧カメラを離した
      expect(recorder.nearFocus).toBe(true)
    })

    test('録画中は切り替えを弾く', async () => {
      setMediaDevices({ enumerateDevices: ultraWideDevices })
      const recorder = new VideoRecorder()
      await startRecording(recorder)
      await expect(recorder.switchNearFocus(true)).rejects.toThrow(
        '録画中はカメラを切り替えられません',
      )
    })

    test('開いていないのに切り替えると弾く', async () => {
      const recorder = new VideoRecorder()
      await expect(recorder.switchNearFocus(true)).rejects.toThrow(
        'カメラを開いていません',
      )
    })
  })

  // 内側 (user) / 外側 (environment) カメラの切替
  describe('内外カメラ切替', () => {
    test('既定は外側 (environment)', async () => {
      const recorder = new VideoRecorder()
      await recorder.open()
      expect(recorder.facing).toBe('environment')
    })

    test('内側へ切り替えると facingMode: user で開き直す', async () => {
      const constraints: MediaStreamConstraints[] = []
      setMediaDevices({
        getUserMedia: async (c) => {
          constraints.push(c)
          return { getVideoTracks: () => [], getTracks: () => [track] }
        },
      })
      const recorder = new VideoRecorder()
      await recorder.open()
      await recorder.setFacing('user')
      expect(recorder.facing).toBe('user')
      const video = constraints.at(-1)?.video as MediaTrackConstraints
      expect(video.facingMode).toBe('user')
    })

    test('内側へ切り替えると近接は解除される', async () => {
      setMediaDevices({
        enumerateDevices: async () =>
          [
            {
              kind: 'videoinput',
              label: 'Back Ultra Wide Camera',
              deviceId: 'ultra',
            },
          ] as MediaDeviceInfo[],
        getUserMedia: async () => ({
          getVideoTracks: () => [],
          getTracks: () => [track],
        }),
      })
      const recorder = new VideoRecorder()
      await recorder.open(true)
      expect(recorder.nearFocus).toBe(true)
      await recorder.setFacing('user')
      expect(recorder.nearFocus).toBe(false)
    })

    test('録画中は内外を切り替えられない', async () => {
      const recorder = new VideoRecorder()
      await startRecording(recorder)
      await expect(recorder.setFacing('user')).rejects.toThrow(
        '録画中はカメラを切り替えられません',
      )
    })
  })

  // トーチ・ズーム (トラックを開き直さず applyConstraints で効く。録画中も可)
  describe('トーチ・ズーム', () => {
    const capableTrack = () => ({
      stop: vi.fn(),
      getCapabilities: () => ({ torch: true, zoom: { min: 1, max: 8 } }),
      applyConstraints: vi.fn(async () => {}),
    })

    test('capabilities で対応状況を返す', async () => {
      const videoTrack = capableTrack()
      setMediaDevices({
        getUserMedia: async () => ({
          getVideoTracks: () => [videoTrack],
          getTracks: () => [videoTrack],
        }),
      })
      const recorder = new VideoRecorder()
      await recorder.open()
      expect(recorder.capabilities()).toEqual({
        torch: true,
        zoom: { min: 1, max: 8 },
      })
    })

    test('録画中でもトーチを点けられる', async () => {
      const videoTrack = capableTrack()
      setMediaDevices({
        getUserMedia: async () => ({
          getVideoTracks: () => [videoTrack],
          getTracks: () => [videoTrack],
        }),
      })
      const recorder = new VideoRecorder()
      await recorder.open()
      recorder.record()
      expect(await recorder.setTorch(true)).toBe(true)
      expect(videoTrack.applyConstraints).toHaveBeenCalledWith({
        advanced: [{ torch: true }],
      })
    })

    test('録画中でもズームできる', async () => {
      const videoTrack = capableTrack()
      setMediaDevices({
        getUserMedia: async () => ({
          getVideoTracks: () => [videoTrack],
          getTracks: () => [videoTrack],
        }),
      })
      const recorder = new VideoRecorder()
      await recorder.open()
      recorder.record()
      expect(await recorder.setZoom(4)).toBe(4)
    })

    test('開いていなければトーチもズームも空振り', async () => {
      const recorder = new VideoRecorder()
      expect(await recorder.setTorch(true)).toBe(false)
      expect(await recorder.setZoom(2)).toBeNull()
      expect(recorder.capabilities()).toEqual({ torch: false, zoom: null })
    })
  })
})

describe('mapCaptureError', () => {
  test('NotAllowedError はカメラ許可の案内にする', () => {
    const e = new Error('Permission denied')
    e.name = 'NotAllowedError'
    expect(mapCaptureError(e).message).toMatch(/カメラの利用が許可/)
  })

  test('NotFoundError はカメラ未検出の案内にする', () => {
    const e = new Error('no device')
    e.name = 'NotFoundError'
    expect(mapCaptureError(e).message).toMatch(/カメラが見つかりません/)
  })

  test('NotReadableError は使用中の案内にする', () => {
    const e = new Error('busy')
    e.name = 'NotReadableError'
    expect(mapCaptureError(e).message).toMatch(/他のアプリ/)
  })

  test('VideoCaptureError はそのまま通す', () => {
    const original = new VideoCaptureError('original')
    expect(mapCaptureError(original)).toBe(original)
  })
})
