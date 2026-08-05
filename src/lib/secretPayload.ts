// シークレット断片として受け入れる中身の判定 (docs/51-部分暗号化計画.md §10、
// docs/53-シークレット挿入拡張計画.md §2, §3)。
//
// **サーバは中身を見られない** (暗号エンベロープしか受け取らない) ので、
// 画像・音声のような署名スニッフはできない。代わりに「復号後の種別 (mime) は
// 既知のものだけ」「大きさは種別ごとの上限まで」の 2 つだけを門にする。
//
// このファイルはブラウザからも import する。**サーバ専用のものを import
// しないこと** — uploads.ts を辿ると env や sharp まで引き込みかねない
// (thumbnail.ts で実際に踏んだ轍)。上限もここに独立して持つ。

// 断片本文の種別。中身は markdown で、通常のメモと同じ描画パイプラインを通す
export const SECRET_TEXT_MIME = 'text/markdown'

// 復号後の中身の種別を申告するヘッダ。**Content-Type ではない** — 本文は
// 暗号文 (octet-stream) であって、この種別のバイト列ではないため。
// 送る側 (ブラウザ) と受ける側 (route) の両方が要るので、client-safe な
// このファイルに置く (route 側の定数を import するとサーバ専用のものが
// クライアントの束に混ざる)。
export const SECRET_MIME_HEADER = 'x-secret-mime'

// 断片の中に貼れる画像。**ブラウザが canvas で出せる形式だけ**にする。
// サーバは復号できないので HEIC → WebP のような変換ができず、変換は挿入時に
// クライアントが済ませる (docs/51 §9)。SVG は画像アップロードと同じ理由で除く
// (スクリプトを埋め込めるため)。
const SECRET_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
])

// 録音 (docs/53 §1)。MediaRecorder が出せる形式だけ。**ブラウザが直接
// 再生できるもの**に限る — 復号したバイト列を Blob URL で <audio> に渡すので、
// サーバ側の変換に頼れない。
const SECRET_AUDIO_MIMES = new Set(['audio/webm', 'audio/mp4'])

// 録画。音声と同じ理由で、ブラウザが直接再生できる形式だけ。
// quicktime は iPhone のカメラロール由来 (.mov) を受けるため。
const SECRET_VIDEO_MIMES = new Set([
  'video/webm',
  'video/mp4',
  'video/quicktime',
])

// 1 断片の上限 (**暗号化した後のバイト列**に対する)。種別で分けるのは通常の
// 添付と同じ考え方で、動画だけ枠が大きい (uploads.ts の MAX_IMAGE_BYTES /
// MAX_VIDEO_BYTES と同じ 10MB / 30MB)。uploads.ts から import しないのは、
// この値をブラウザ側の事前チェックでも使うため (冒頭のとおり)。
export const MAX_SECRET_BYTES = 10 * 1024 * 1024 + 1024
export const MAX_SECRET_VIDEO_BYTES = 30 * 1024 * 1024 + 1024

// 復号後にどう描くか。表示側 (SecretBlock) の振り分けにも使う
export type SecretKind = 'text' | 'image' | 'audio' | 'video'

export function secretMimeKind(mime: string): SecretKind | null {
  if (mime === SECRET_TEXT_MIME) {
    return 'text'
  }
  if (SECRET_IMAGE_MIMES.has(mime)) {
    return 'image'
  }
  if (SECRET_AUDIO_MIMES.has(mime)) {
    return 'audio'
  }
  if (SECRET_VIDEO_MIMES.has(mime)) {
    return 'video'
  }
  return null
}

export function isSecretImageMime(mime: string): boolean {
  return SECRET_IMAGE_MIMES.has(mime)
}

export function isSecretMime(mime: string): boolean {
  return secretMimeKind(mime) !== null
}

// File.type を保存に使う形へ均す。
//
// MediaRecorder は `audio/webm;codecs=opus` のようにパラメータを付ける。
// 許可リストは完全一致で見る方針 (サーバが中身を確かめられない以上、
// 曖昧に受けたくない) なので、基本形へ落としてから照合する。
//
// **均すのは暗号化より前**でなければならない。AAD が mime を縛っているため、
// 封をした後に mime を変えると復号できなくなる (docs/51 §7)。
export function normalizeSecretMime(rawType: string): string {
  return rawType.split(';')[0].trim().toLowerCase()
}

export interface SecretRejection {
  status: number
  error: string
}

// その種別で許される最大バイト数
function maxBytesFor(mime: string): number {
  return secretMimeKind(mime) === 'video'
    ? MAX_SECRET_VIDEO_BYTES
    : MAX_SECRET_BYTES
}

// 保存してよい申告か。問題なければ null (uploads.ts の checkUploadRequest と
// 同じ形にして、route 側の書き方を揃える)。
export function checkSecretPayload(
  mime: string,
  byteLength: number,
): SecretRejection | null {
  if (!isSecretMime(mime)) {
    return { status: 400, error: 'この種類はシークレットにできません' }
  }
  if (byteLength === 0) {
    return { status: 400, error: '中身がありません' }
  }
  const limit = maxBytesFor(mime)
  if (byteLength > limit) {
    return {
      status: 413,
      error: `シークレットが大きすぎます (最大 ${Math.round(
        limit / 1024 / 1024,
      )}MB)`,
    }
  }
  return null
}
