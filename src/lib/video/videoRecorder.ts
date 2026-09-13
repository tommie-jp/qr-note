// ノート編集画面からのその場録画 (41-QR-search/docs/14-動画挿入計画.md)。
// lib/audio/audioRecorder.ts が原型で、音声を動画に置き換えた鏡写し。
//
// 録画した動画はそのまま /api/images へ送り、サーバが中身を見て保存する。
// 変換はしない (音声・PDF と同じ「素通し」方針)。ポスター (先頭フレームの
// WebP) はクライアントが別途作って同じ POST で送る (videoPoster.ts)。

import fixWebmDuration from 'fix-webm-duration'
import { timestampFileName, timestampLabel } from '../datetime'
import { MAX_VIDEO_BYTES } from '../uploads'
import {
  applyNearFocusZoom,
  applyTorch,
  applyZoom,
  type CameraCapabilities,
  findUltraWideDeviceId,
  isFrontFacing,
  readCameraCapabilities,
} from './cameraSelection'

// 内側 (自撮り) / 外側 (背面) カメラ。近接 (超広角) は外側専用。
export type CameraFacing = 'environment' | 'user'

// 試す順に並べる。音声と同じく **Safari だけを mp4/H.264+AAC に寄せ、他は
// webm/VP9+Opus のまま**にする。振り分けは UA 判定ではなく対応状況の実測で行う
// (`codecs=avc1...,mp4a...` まで書いた文字列は Safari だけが対応と答える)。
//
// 素の `video/mp4` は Chrome も対応と答えうるので、**必ず webm より後ろに置く**
// (前に出すと Chrome まで mp4 になり、検証しやすい webm 経路を手放す)。
//
// **サーバが受けられる形式だけを並べる** — ここに増やすなら uploads.ts の
// sniffVideoFormat も一緒に広げること。
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // Safari / iOS
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

// 720p で文字が読める最低ライン (41-QR-search/docs/14 のおすすめ設定)。明示しないと
// ブラウザ任せになり、画質もサイズも安定しない。
export const VIDEO_BITS_PER_SECOND = 1_000_000
// 音声は音声録音と同じ 64kbps あれば十分明瞭。
export const AUDIO_BITS_PER_SECOND = 64_000
// 自動停止・推定サイズに使う合計ビットレート。
export const TOTAL_BITS_PER_SECOND = VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND

// 720p 相当の解像度指定 (全経路で共通)。
const SIZE_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
} as const

// 通常経路。カメラは背面 (メモ用途は手元や周囲を写すのが主)。facingMode は
// plain (ideal 相当) — exact にすると背面の無い PC で開けなくなる。
function buildVideoConstraints(facing: CameraFacing): MediaTrackConstraints {
  return { facingMode: facing, ...SIZE_CONSTRAINTS }
}

// 近接 (超広角) 経路。deviceId 名指しに **facingMode: { exact: 'environment' } を
// 添えて「前面では絶対に開かない」を制約で保証する** — iOS Safari には deviceId を
// 前面カメラに誤解決する癖があり (41-QR-search/docs/16)、ideal では抑止できなかった。exact なら
// 誤解決時は OverconstrainedError で失敗し、呼び出し側が通常背面へフォールバック
// する (前面で開くより近接なしの方がまし)。
function buildUltraWideConstraints(deviceId: string): MediaTrackConstraints {
  return {
    deviceId: { exact: deviceId },
    facingMode: { exact: 'environment' },
    ...SIZE_CONSTRAINTS,
  }
}

// 自動停止までの長さ (3 分)。TOTAL_BITS_PER_SECOND で 3 分 ≈ 24MB となり、
// アップロード上限 MAX_VIDEO_BYTES (30MB) にコンテナのオーバーヘッド分の
// 余裕を残して収まる。**上限を設けないと、長い録画がアップロードで丸ごと
// 失われる** — 録り終えてから断られるのがいちばん損なので、その手前で止める。
export const MAX_RECORDING_MS = 3 * 60 * 1000

// ビットレートを変えても破綻しないための保険。推定サイズが上限の 9 割に達したら
// 時間より先に止める (useVideoRecording が時間と併せて監視する)。
export const SIZE_STOP_RATIO = 0.9

// 経過ミリ秒から出力サイズを見積もる (ビットレート × 経過秒 ÷ 8)。
export function estimatedBytes(elapsedMs: number): number {
  return (TOTAL_BITS_PER_SECOND / 8) * (elapsedMs / 1000)
}

// 推定サイズが上限の SIZE_STOP_RATIO に達する経過ミリ秒。時間上限と併せ、
// 早い方で止める。
export const SIZE_STOP_MS =
  ((MAX_VIDEO_BYTES * SIZE_STOP_RATIO) / (TOTAL_BITS_PER_SECOND / 8)) * 1000

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
}

// 保存名の拡張子。サーバは中身を見て自分で名前を決めるので、ここで付ける
// 拡張子は「クライアント側で動画と判る」ためのもの (MemoEditorInner の判定)。
export function extensionFor(mimeType: string): string {
  if (mimeType.startsWith('video/webm')) {
    return 'webm'
  }
  if (mimeType.startsWith('video/mp4')) {
    return 'mp4'
  }
  return 'bin' // MIME_CANDIDATES の範囲では起きない
}

// 本文の alt に残す録画日時 (`![録画 2026-07-20 14:03:12](url)`)。録音と同じ狙いで、
// UUID 名では失われる手がかりを本文に載せ、PGroonga の全文検索から引ける。
// 組み立ては録音と共通で、違うのは語とファイル名の接頭辞だけ (datetime.ts)
export function recordingAltText(at: Date): string {
  return timestampLabel('録画', at)
}

export function recordingFileName(at: Date, ext: string): string {
  return timestampFileName('video', at, ext)
}

export interface Recording {
  // そのまま /api/images へ送れる形。名前と mime は付け直さない
  file: File
  durationMs: number
  // 録画を**開始**した時刻。本文の alt に出す (終了時刻より意味が通る)
  recordedAt: Date
}

export class VideoCaptureError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'VideoCaptureError'
    this.cause = cause
  }
}

export function mapCaptureError(e: unknown): VideoCaptureError {
  if (e instanceof VideoCaptureError) {
    return e
  }
  const err = e instanceof Error ? e : new Error(String(e))
  const msg = err.message
  if (err.name === 'NotAllowedError' || /Permission/i.test(msg)) {
    return new VideoCaptureError(
      'カメラの利用が許可されていません。ブラウザの設定からカメラ許可を確認して下さい。',
      e,
    )
  }
  if (err.name === 'NotFoundError') {
    return new VideoCaptureError('カメラが見つかりません。', e)
  }
  if (err.name === 'NotReadableError') {
    return new VideoCaptureError(
      'カメラを開始できませんでした。他のアプリがカメラを使っていないか確認して下さい。',
      e,
    )
  }
  return new VideoCaptureError(msg || '録画を開始できませんでした。', e)
}

// 録画直後の手当て。Firefox は webm の Duration を 0 で書くため、<video> の長さが
// Infinity になりシークできない。実測の長さを書き込む (音声と同じ処理で、動画の
// webm にもそのまま効く)。**mp4 (Safari) の moov 並べ替えはサーバ側でやる**
// (attachmentStore の video 分岐)。
async function prepareForUpload(
  blob: Blob,
  mimeType: string,
  durationMs: number,
): Promise<Blob> {
  if (!mimeType.startsWith('video/webm')) {
    return blob
  }
  return fixWebmDuration(blob, durationMs, { logger: false })
}

export class VideoRecorder {
  private recorder: MediaRecorder | null = null
  private mediaStream: MediaStream | null = null
  private videoTrack: MediaStreamTrack | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private nearFocusOn = false
  private facingMode: CameraFacing = 'environment'
  // 背面超広角の deviceId。**ストリームが生きているうちに** open() で控える。
  // トラックを止めた後の enumerateDevices はラベルが消えて探し直せないことが
  // あるため、切替時はこのキャッシュを使う。誤解決が判明したら null に戻す
  private ultraWideId: string | null = null

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  // カメラを開いているか (プレビュー中も録画中も true)。
  get isOpen(): boolean {
    return this.mediaStream !== null
  }

  // 近接 (超広角) で開いているか。UI のトグル表示に使う。
  get nearFocus(): boolean {
    return this.nearFocusOn
  }

  // いま内側 (user) / 外側 (environment) どちらで開いているか。
  get facing(): CameraFacing {
    return this.facingMode
  }

  // 近接 (超広角) へ切り替えられる端末か。open() 後に有効 (ラベルは gUM 許可後に
  // しか出ないため)。UI の近接ボタンの出し分けに使う。
  get hasUltraWide(): boolean {
    return this.ultraWideId !== null
  }

  // ライブプレビュー用の MediaStream (<video srcObject>)。開いていなければ null。
  get stream(): MediaStream | null {
    return this.mediaStream
  }

  // いまのトラックのトーチ・ズーム対応状況。開いていなければ両方なし。
  capabilities(): CameraCapabilities {
    return this.videoTrack
      ? readCameraCapabilities(this.videoTrack)
      : { torch: false, zoom: null }
  }

  // プレビュー用にカメラ・マイクを開く (まだ録画しない)。AF が落ち着いてから
  // record() を呼べるので、「録画の頭がボケる」問題を避けられる。録画できない
  // 端末はここで弾く (プレビューだけ出て録れない、を防ぐ)。
  //
  // nearFocus=true でも超広角が見つからなければ通常カメラで開く (結果は
  // this.nearFocus で判る)。マイクも同時に開く — 録画開始時に開き直すと、その
  // 瞬間に AF とレンズ選択がやり直され、近接の狙いが崩れるため。
  async open(nearFocus = false): Promise<void> {
    if (this.mediaStream) {
      throw new VideoCaptureError('既にカメラを開いています。')
    }
    if (!pickMimeType()) {
      throw new VideoCaptureError('この端末は動画録画に対応していません。')
    }
    await this.acquireStream({ facing: 'environment', nearFocus })
    // 近接ボタンの出し分け用に、ストリームが生きている今のうちに超広角を控える
    // (acquireStream 内で既に探していれば二重には探さない)
    this.ultraWideId ??= await findUltraWideDeviceId()
  }

  // プレビュー中にレンズを切り替える (近接=超広角 ⇔ 通常)。近接は外側専用なので
  // facing は environment に固定する。**録画中は不可**。
  async switchNearFocus(nearFocus: boolean): Promise<void> {
    await this.reopen({ facing: 'environment', nearFocus })
  }

  // プレビュー中に内側/外側カメラを切り替える。内側 (user) は単眼なので近接は
  // 自動で解除する (nearFocus=false)。**録画中は不可**。
  async setFacing(facing: CameraFacing): Promise<void> {
    await this.reopen({ facing, nearFocus: false })
  }

  // トーチ (ライト) を点灯/消灯し、適用できたかを返す。トラックはそのままなので
  // **録画中でも効く** (暗いと気づいてから点けられる)。非対応端末は false。
  async setTorch(on: boolean): Promise<boolean> {
    return this.videoTrack ? applyTorch(this.videoTrack, on) : false
  }

  // zoom を適用し、実際に適用した値を返す。トラックはそのままなので**録画中でも
  // 効く**。非対応端末は null。
  async setZoom(value: number): Promise<number | null> {
    return this.videoTrack ? applyZoom(this.videoTrack, value) : null
  }

  // プレビュー中にカメラを開き直す共通処理 (近接・内外切替)。
  // iOS は 2 カメラ同時 gUM で NotReadableError になり得るので、**旧トラックを
  // 先に止めてから**開き直す。録画中は MediaRecorder がトラック差し替えに
  // 耐えないため弾く。
  private async reopen(opts: {
    facing: CameraFacing
    nearFocus: boolean
  }): Promise<void> {
    if (this.isRecording) {
      throw new VideoCaptureError('録画中はカメラを切り替えられません。')
    }
    if (!this.mediaStream) {
      throw new VideoCaptureError('カメラを開いていません。')
    }
    this.mediaStream.getTracks().forEach((track) => track.stop())
    this.mediaStream = null
    this.videoTrack = null
    this.nearFocusOn = false
    await this.acquireStream(opts)
  }

  // 開いているストリームで録画を始める。open() 済みが前提。失敗したら
  // カメラ・マイクを離してプレビューごと畳む (半端に開いたまま残さない)。
  record(): void {
    if (!this.mediaStream) {
      throw new VideoCaptureError('カメラを開いていません。')
    }
    if (this.recorder) {
      throw new VideoCaptureError('既に録画中です。')
    }
    const mimeType = pickMimeType()
    if (!mimeType) {
      throw new VideoCaptureError('この端末は動画録画に対応していません。')
    }
    const stream = this.mediaStream
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      })
      this.chunks = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data)
        }
      }
      recorder.start()
      this.recorder = recorder
      this.startedAt = Date.now()
    } catch (e) {
      stream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
      this.videoTrack = null
      this.nearFocusOn = false
      this.chunks = []
      throw mapCaptureError(e)
    }
  }

  // gUM でストリームを確保する。近接 (外側専用) なら超広角経路を先に試し、
  // 開けなければ通常背面へフォールバック (近接なしで開く方が、開けない・前面で
  // 開くよりまし)。失敗したら**何も掴んだまま残さない** (this.mediaStream に
  // まだ入っていないので、ここで離さないと誰も track.stop() を呼べず、カメラ
  // 使用中表示が残る)。
  private async acquireStream(opts: {
    facing: CameraFacing
    nearFocus: boolean
  }): Promise<void> {
    // 近接は外側 (背面超広角) 専用。内側では試さない
    if (opts.nearFocus && opts.facing === 'environment') {
      this.ultraWideId ??= await findUltraWideDeviceId()
      if (this.ultraWideId && (await this.tryAcquireUltraWide(this.ultraWideId))) {
        return
      }
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(opts.facing),
        audio: true,
      })
    } catch (e) {
      throw mapCaptureError(e)
    }
    this.adoptStream(stream, opts.facing, false)
  }

  // 超広角を deviceId 名指し + facingMode exact で開く。開けたら true。
  // iOS が deviceId を前面に誤解決した場合は exact 側で OverconstrainedError に
  // なるか、万一 exact も無視されたら開けた実トラックの検証で弾く — どちらの
  // 経路でもキャッシュを捨てて false を返し、呼び出し側が通常背面で開き直す。
  private async tryAcquireUltraWide(deviceId: string): Promise<boolean> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: buildUltraWideConstraints(deviceId),
        audio: true,
      })
    } catch {
      this.ultraWideId = null // id が古い・誤解決。次の open() で探し直す
      return false
    }
    const track = stream.getVideoTracks()[0] ?? null
    if (track && isFrontFacing(track)) {
      stream.getTracks().forEach((t) => t.stop())
      this.ultraWideId = null
      return false
    }
    this.adoptStream(stream, 'environment', true)
    if (track) {
      await applyNearFocusZoom(track)
    }
    return true
  }

  private adoptStream(
    stream: MediaStream,
    facing: CameraFacing,
    nearFocus: boolean,
  ): void {
    this.mediaStream = stream
    this.videoTrack = stream.getVideoTracks()[0] ?? null
    this.facingMode = facing
    this.nearFocusOn = nearFocus
  }

  async stop(): Promise<Recording> {
    const recorder = this.recorder
    const stream = this.mediaStream
    if (!recorder || !stream) {
      throw new VideoCaptureError('録画中ではありません。')
    }
    const recordedAt = new Date(this.startedAt)

    let rawBlob: Blob
    let mimeType: string
    let durationMs: number
    try {
      // recorder.stop() は既に inactive なら InvalidStateError を投げる。
      // finally で必ず後始末する — さもないと this.recorder が残り、以後の
      // start() が「既に録画中です」で永久に弾かれる (audioRecorder と同旨)。
      ;({ blob: rawBlob, mimeType, durationMs } = await new Promise<{
        blob: Blob
        mimeType: string
        durationMs: number
      }>((resolve) => {
        recorder.onstop = () => {
          const type = recorder.mimeType
          resolve({
            blob: new Blob(this.chunks, { type }),
            mimeType: type,
            durationMs: Date.now() - this.startedAt,
          })
        }
        recorder.stop()
      }))
    } finally {
      stream.getTracks().forEach((track) => track.stop())
      this.recorder = null
      this.mediaStream = null
      this.videoTrack = null
      this.nearFocusOn = false
      this.chunks = []
    }

    const blob = await prepareForUpload(rawBlob, mimeType, durationMs)
    const name = recordingFileName(recordedAt, extensionFor(mimeType))
    return {
      file: new File([blob], name, { type: mimeType }),
      durationMs,
      recordedAt,
    }
  }

  // 中断 (画面離脱・プレビュー取消・エラー時)。結果は捨てるが、カメラ・マイクは
  // 必ず離す。プレビュー中 (recorder 未生成) でも mediaStream を確実に止める。
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.mediaStream?.getTracks().forEach((track) => track.stop())
    this.recorder = null
    this.mediaStream = null
    this.videoTrack = null
    this.nearFocusOn = false
    this.chunks = []
  }
}
