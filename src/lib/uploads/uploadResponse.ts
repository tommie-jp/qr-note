// `POST /api/images` の応答 (共通エンベロープ `{success, data, error}`) を
// 解釈して画像 URL を取り出す。XHR 側の薄いグルーからロジックだけを分けて
// 単体テストできるようにする (uploadImageXhr.ts)。
//
// 失敗は例外で返す。成功したのに url が無い応答も「失敗」に倒す —
// undefined をそのまま通すと本文に `![](undefined)` が入ってしまい、
// 壊れた画像リンクが黙って保存される。
//
// 封筒の開け方は api/envelope.ts の openEnvelope (XHR なので fetch 側の読み手は使わない)。

import { ApiError, openEnvelope } from '../api/envelope'

export function parseUploadResponse(status: number, responseText: string): string {
  let body: unknown
  try {
    body = JSON.parse(responseText)
  } catch {
    body = null
  }

  const opened = openEnvelope(status, body)
  if (!opened.ok) {
    throw new ApiError(opened.error ?? `アップロードに失敗しました (HTTP ${status})`, status)
  }

  const url = (opened.data as { url?: unknown } | null | undefined)?.url
  if (typeof url !== 'string' || url === '') {
    throw new Error('アップロードに失敗しました (応答に画像 URL がありません)')
  }
  return url
}
