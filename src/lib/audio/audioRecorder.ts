// ノート編集画面からのその場録音 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md
// 「ノート内録音の実装計画」)。~/27-tommieVox/src/lib/audioRecorder.ts が原型。
//
// 録音した音声はそのまま /api/images へ送り、サーバが中身を見て保存する。
// 変換はしない (音声・PDF と同じ「素通し」方針)。

import fixWebmDuration from 'fix-webm-duration'

// 試す順に並べる。**Safari だけを mp4/AAC に寄せ、他は webm/opus のまま**に
// したい (41-QR-search/docs/12「iPhone で 1 回目が無音になる件」)。
//
// もともと webm を先頭に置いていたが、Safari が webm 録音に対応した結果
// iPhone でも webm が選ばれるようになり、その再生が不安定だった。WebKit に
// とって本流なのは mp4/AAC (ボイスメモと同じ経路) なので、そちらへ寄せる。
//
// 振り分けは UA 判定ではなく**対応状況の実測**で行う。`codecs=mp4a.40.2` まで
// 書いた文字列は Safari だけが対応と答え、Chrome は非対応と答えるため、
// これを先頭に置くだけで狙った分岐になる (Playwright で実測):
//
//   | 文字列                       | Safari | Chrome | Firefox |
//   | audio/mp4;codecs=mp4a.40.2  | 対応   | 非対応 | 非対応  |
//   | audio/webm;codecs=opus      | 対応   | 対応   | 対応    |
//
// 素の `audio/mp4` は Chrome も対応と答えるので、**必ず webm より後ろに置く**
// (前に出すと Chrome まで mp4 になり、検証済みの webm 経路を手放すことになる)。
//
// **サーバが受けられる形式だけを並べる** — ここに増やすなら uploads.ts の
// sniffAudioFormat も一緒に広げること。
const MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
]

// 明示しないとブラウザ任せ (実測で倍近くなる) になる。音声のみなので
// 64kbps あれば十分明瞭 (41-QR-search/docs/12・tommieVox の形式調査)。
export const AUDIO_BITS_PER_SECOND = 64_000

// 自動停止までの長さ。64kbps = 8KB/s なので 15 分で約 7.2MB、
// アップロード上限 10MB に対してコンテナのオーバーヘッド分の余裕がある。
// **上限を設けないと、長時間録音がアップロードで丸ごと失われる** —
// 録り終えてから断られるのがいちばん損なので、その手前で止める。
export const MAX_RECORDING_MS = 15 * 60 * 1000

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
}

// 保存名の拡張子。サーバは中身を見て自分で名前を決めるので、ここで付ける
// 拡張子は「クライアント側で音声と判る」ためのもの (MemoEditorInner の判定)。
export function extensionFor(mimeType: string): string {
  if (mimeType.startsWith('audio/webm')) {
    return 'webm'
  }
  if (mimeType.startsWith('audio/mp4')) {
    return 'm4a'
  }
  return 'bin' // MIME_CANDIDATES の範囲では起きない
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// 本文の alt に残す録音日時 (`![録音 2026-07-20 14:03:12](url)`)。
// PDF で元ファイル名を alt に残したのと同じ理由 — UUID 名では失われる手がかりが
// 本文に載り、PGroonga の全文検索から引ける。通し番号でなく日時にするのは、
// 番号がノートを跨ぐと意味を失うのに対し、日時は後から手がかりになるため。
export function recordingAltText(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  return `録音 ${date} ${time}`
}

export function recordingFileName(at: Date, ext: string): string {
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `recording-${date}-${time}.${ext}`
}

export interface Recording {
  // そのまま /api/images へ送れる形。名前と mime は付け直さない
  file: File
  durationMs: number
  // 録音を**開始**した時刻。本文の alt に出す (終了時刻より意味が通る)
  recordedAt: Date
}

export class AudioCaptureError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AudioCaptureError'
    this.cause = cause
  }
}

// iOS Safari は <audio> の再生などで AudioSession カテゴリが `playback` に
// 固定されると getUserMedia を拒否する。ユーザー操作の中で AudioContext を
// resume すると capture 可能なカテゴリへ戻る。
// **このアプリは本文に <audio> を埋め込むので「再生した直後に録音」がまさに
// この罠を踏む。** 実質必須の下ごしらえ。
async function primeAudioSession(): Promise<void> {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
  if (!Ctor) {
    return
  }
  try {
    const ctx = new Ctor()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    void ctx.close()
  } catch {
    // 下ごしらえが失敗しても本命の getUserMedia は試す。ここで諦める理由はない
    // (踏んでいれば getUserMedia 側が AudioSession のエラーを返し、
    // mapCaptureError が対処法を出す)
  }
}

export function mapCaptureError(e: unknown): AudioCaptureError {
  if (e instanceof AudioCaptureError) {
    return e
  }
  const err = e instanceof Error ? e : new Error(String(e))
  const msg = err.message
  if (/AudioSession|not compatible with audio capture/i.test(msg)) {
    return new AudioCaptureError(
      'iOS Safari でマイクを使えない状態です。ページを開き直してから、音声を再生せずに録音して下さい。',
      e,
    )
  }
  if (err.name === 'NotAllowedError' || /Permission/i.test(msg)) {
    return new AudioCaptureError(
      'マイクの利用が許可されていません。ブラウザの設定からマイク許可を確認して下さい。',
      e,
    )
  }
  if (err.name === 'NotFoundError') {
    return new AudioCaptureError('マイクが見つかりません。', e)
  }
  return new AudioCaptureError(msg || '録音を開始できませんでした。', e)
}

// 録音直後の手当て。Firefox は webm の Segment Info の Duration を 0 で書くため、
// <audio> の長さが Infinity になりシークできない。実測の長さを書き込む
// (Chrome は既に正しく書いており、ライブラリ側が素通しにする)。
//
// fixWebmDuration は失敗しても throw せず**元の blob をそのまま返す**。
// 長さ不明でも再生自体はできるため、録音を失うより望ましい degradation として
// 受け入れる (握り潰しではなく、そういう契約のライブラリ)。
//
// **mp4 (Safari) の moov 並べ替えはここでやらない** — サーバの保存経路
// (api/images/route.ts) に置いてある。録音だけでなく、iPhone のボイスメモを
// 添付した場合も同じ問題を踏むため (mp4Faststart.ts に経緯)。
async function prepareForUpload(
  blob: Blob,
  mimeType: string,
  durationMs: number,
): Promise<Blob> {
  if (!mimeType.startsWith('audio/webm')) {
    return blob
  }
  // logger 既定は console へ書く。アプリにコンソールパネルがあり紛れるので黙らせる
  return fixWebmDuration(blob, durationMs, { logger: false })
}

export class AudioRecorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private startedAt = 0

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  async start(): Promise<void> {
    if (this.recorder) {
      throw new AudioCaptureError('既に録音中です。')
    }
    const mimeType = pickMimeType()
    if (!mimeType) {
      throw new AudioCaptureError('この端末は音声録音に対応していません。')
    }

    await primeAudioSession()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      throw mapCaptureError(e)
    }

    // getUserMedia の後は**何で失敗してもマイクを離す**。
    // MediaRecorder の生成だけでなく start() も InvalidStateError を投げうるが、
    // その時点では this.stream にまだ入っていないので、ここで離さないと
    // 誰も track.stop() を呼べなくなる (タブのマイク使用中表示が残り続ける)
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
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
      this.stream = stream
      this.startedAt = Date.now()
    } catch (e) {
      stream.getTracks().forEach((track) => track.stop())
      this.chunks = []
      throw mapCaptureError(e)
    }
  }

  async stop(): Promise<Recording> {
    const recorder = this.recorder
    const stream = this.stream
    if (!recorder || !stream) {
      throw new AudioCaptureError('録音中ではありません。')
    }
    const recordedAt = new Date(this.startedAt)

    let rawBlob: Blob
    let mimeType: string
    let durationMs: number
    try {
      // recorder.stop() は既に inactive なら InvalidStateError を投げる
      // (OS 側でマイクを取り上げられた・端末が外れた等で勝手に止まっていた場合)。
      // finally で必ず後始末する — さもないと this.recorder が残り、以後の
      // start() が「既に録音中です」で永久に弾かれる
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
      this.stream = null
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

  // 中断 (画面離脱・エラー時)。結果は捨てるが、マイクは必ず離す
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    this.recorder = null
    this.stream = null
    this.chunks = []
  }
}
