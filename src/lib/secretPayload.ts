// シークレット断片として受け入れる中身の判定 (docs/51-部分暗号化計画.md §10)。
//
// **サーバは中身を見られない** (暗号エンベロープしか受け取らない) ので、
// 画像・音声のような署名スニッフはできない。代わりに「復号後の種別 (mime) は
// 既知のものだけ」「大きさは上限まで」の 2 つだけを門にする。
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

// 1 断片の上限。**暗号化した後のバイト列**に対する上限で、画像 1 枚分
// (uploads.ts の MAX_IMAGE_BYTES と同じ 10MB) にエンベロープの余白を足したもの。
// uploads.ts から import しないのは、この値をブラウザ側の事前チェックでも
// 使うため (冒頭のとおりサーバ専用のものを引き込まない)。
export const MAX_SECRET_BYTES = 10 * 1024 * 1024 + 1024

export function isSecretImageMime(mime: string): boolean {
  return SECRET_IMAGE_MIMES.has(mime)
}

export function isSecretMime(mime: string): boolean {
  return mime === SECRET_TEXT_MIME || isSecretImageMime(mime)
}

export interface SecretRejection {
  status: number
  error: string
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
  if (byteLength > MAX_SECRET_BYTES) {
    return {
      status: 413,
      error: `シークレットが大きすぎます (最大 ${Math.round(
        MAX_SECRET_BYTES / 1024 / 1024,
      )}MB)`,
    }
  }
  return null
}
