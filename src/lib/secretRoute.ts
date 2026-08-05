// シークレットの口が共通で使う門番と本文の読み取り
// (docs/51-部分暗号化計画.md §10)。
//
// 断片は base64 にせず application/octet-stream で生のまま運ぶ (数 MB を
// 33% 太らせないため)。復号後の種別だけをヘッダで申告させる。

import { NextResponse } from 'next/server'
import { denyCrossSite, denyIfDemoMode, denyUnlessLoggedIn } from './apiAuth'
import {
  checkSecretPayload,
  MAX_SECRET_VIDEO_BYTES,
  SECRET_MIME_HEADER,
} from './secretPayload'
import { checkUploadRequest, MULTIPART_OVERHEAD_BYTES } from './uploads'

export function secretFail(status: number, error: string): NextResponse {
  return NextResponse.json(
    { success: false, data: null, error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

// どの口にも共通の門番。
//
// デモを最初に断つのは apiAuth.ts の作法どおり (共有アカウントのデモでは
// 鍵を分け合えないので、機能ごと閉じる。docs/51 §10)。
export async function denySecretRequest(
  request: Request,
): Promise<NextResponse | null> {
  return (
    denyIfDemoMode() ?? (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  )
}

// 書き込みの口 (POST / PUT) の本文を読む。断られた場合は NextResponse を返す。
export async function readSecretBody(
  request: Request,
): Promise<{ mime: string; bytes: Uint8Array<ArrayBuffer> } | NextResponse> {
  // 本文を読む前に弾けるものを弾く (Origin と Content-Length)。
  // 画像アップロードと同じ関数を通すことで、CSRF の線引きを 1 か所に保つ。
  //
  // 上限に MULTIPART_OVERHEAD_BYTES を足すのは、あの関数が multipart 前提で
  // 「上限 = 本文 + 包み」と数え、超過メッセージからも同じ分を引くため。
  // ここは生のバイト列なので包みは無く、足しておかないと実態と違う文言になる。
  //
  // ここで見るのは**全種別の最大** (動画枠)。種別ごとの上限は下の
  // checkSecretPayload が実測で絞る (uploads.ts の maxUploadBytes と
  // maxAttachmentBytes を分けているのと同じ二段構え)
  const rejection = checkUploadRequest(
    request,
    MAX_SECRET_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES,
  )
  if (rejection) {
    return secretFail(rejection.status, rejection.error)
  }

  const mime = request.headers.get(SECRET_MIME_HEADER) ?? ''

  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(await request.arrayBuffer())
  } catch (error) {
    // 途中で切れた通信など。400 を返すが原因はログに残す (api/images と同じ)
    console.error('シークレットの本文の読み取りに失敗しました:', error)
    return secretFail(400, '本文を読み取れませんでした')
  }

  // 申告 (Content-Length) が無くても実測で必ず確かめる
  const denied = checkSecretPayload(mime, bytes.byteLength)
  if (denied) {
    return secretFail(denied.status, denied.error)
  }

  return { mime, bytes }
}
