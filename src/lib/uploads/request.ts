// アップロードの要求を、本文を読む前に断る門 (docs/93-リファクタリング計画.md §4-2)。
// 画像アップロード (api/images)・ZIP 取り込み (api/import)・シークレット
// (secretRoute) が共有する。

import { maxUploadBytes, MULTIPART_OVERHEAD_BYTES, tooLargeMessage } from './limits'

export interface UploadRejection {
  status: number
  error: string
}

// 本文を読む前に弾けるものだけを見る。問題なければ null。
//
// maxBodyBytes を差し替えられるのは ENEX インポート (docs/28 §4) のため。
// ENEX は 1 ファイルに全ノートと添付が入るので画像 1 枚より桁が大きい。
// **CSRF の判定はどの経路でも同じ**なので、上限だけを引数にして本体は共有する。
//
// 既定を定数ではなく maxUploadBytes() から都度求めるのは、DEMO_MODE を
// 起動時 env で切り替えるため (docs/38 §5)。デモでは本文上限も 2MB に縮む。
export function checkUploadRequest(
  request: Request,
  maxBodyBytes: number = maxUploadBytes() + MULTIPART_OVERHEAD_BYTES,
): UploadRejection | null {
  // CSRF 対策: ブラウザがクロスオリジン POST に付ける Origin がホストと
  // 食い違う場合は本文を読む前に拒否する (同一オリジンの fetch は許可)
  const origin = request.headers.get('origin')
  if (origin && !isSameOrigin(origin, request)) {
    return { status: 403, error: 'クロスオリジンのアップロードは許可されていません' }
  }

  // メモリ枯渇対策: formData() は本文全体をバッファするため、
  // Content-Length の時点で明らかに大きすぎるものは先に弾く
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > maxBodyBytes) {
    return {
      status: 413,
      error: tooLargeMessage(maxBodyBytes - MULTIPART_OVERHEAD_BYTES),
    }
  }

  return null
}

function isSameOrigin(origin: string, request: Request): boolean {
  const host = request.headers.get('host') ?? new URL(request.url).host
  try {
    return new URL(origin).host === host
  } catch {
    // パースできない Origin は正規のブラウザが送るものではない。同一とはみなさない
    return false
  }
}
