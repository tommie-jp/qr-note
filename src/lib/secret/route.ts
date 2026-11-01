// シークレットの口が共通で使う門番と本文の読み取り
// (docs/51-部分暗号化計画.md §10)。
//
// 断片は base64 にせず application/octet-stream で生のまま運ぶ (数 MB を
// 33% 太らせないため)。復号後の種別だけをヘッダで申告させる。

import type { NextResponse } from 'next/server'
import { readBodyBounded } from '../route/boundedBody'
import { guardRecentLogin, guardRequest, type GuardResult } from '../route/guard'
import { apiFail } from '../route/respond'
import {
  checkSecretPayload,
  MAX_SECRET_VIDEO_BYTES,
  SECRET_MIME_HEADER,
} from './payload'
import { MULTIPART_OVERHEAD_BYTES } from '../uploads/limits'
import { checkUploadRequest } from '../uploads/request'

// どの口にも共通の門番。
//
// デモを最初に断つのは route/guard.ts の作法どおり (共有アカウントのデモでは
// 鍵を分け合えないので、機能ごと閉じる。docs/51 §10)。
export function guardSecretRequest(request: Request): Promise<GuardResult> {
  return guardRequest(request, { demo: 'deny' })
}

// 鍵束を書き換える口 (初回設定・包みの追加) の門番。セッションを持っているだけ
// では通さず、ログインし直して 10 分以内を要求する (auth/stepUp.ts。2026-11 の
// 監査 M-6)。盗んだセッションで鍵束を先取り・上書きされると、持ち主が解錠
// できなくなり作り直しの入口も無い
export function guardSecretWriteRequest(request: Request): Promise<GuardResult> {
  return guardRecentLogin(request, { demo: 'deny' })
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
  // checkSecretPayload が実測で絞る (uploads/limits.ts の maxUploadBytes と
  // maxAttachmentBytes を分けているのと同じ二段構え)
  const rejection = checkUploadRequest(
    request,
    MAX_SECRET_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES,
  )
  if (rejection) {
    return apiFail(rejection.error, rejection.status)
  }

  const mime = request.headers.get(SECRET_MIME_HEADER) ?? ''

  // 読みながら数える。Content-Length を申告しない送信 (chunked) は上の事前検査を
  // 素通りし、全部読んでから測ると 1 人でメモリを食い尽くせる
  // (route/boundedBody.ts。api/clipboard/data と同じ作り)
  let bytes: Uint8Array<ArrayBuffer> | null
  try {
    bytes = await readBodyBounded(request, MAX_SECRET_VIDEO_BYTES)
  } catch (error) {
    // 途中で切れた通信など。400 を返すが原因はログに残す (api/images と同じ)
    console.error('シークレットの本文の読み取りに失敗しました:', error)
    return apiFail('本文を読み取れませんでした', 400)
  }
  if (bytes === null) {
    return apiFail('本文が大きすぎます', 413)
  }

  // 申告 (Content-Length) が無くても実測で必ず確かめる
  const denied = checkSecretPayload(mime, bytes.byteLength)
  if (denied) {
    return apiFail(denied.error, denied.status)
  }

  return { mime, bytes }
}
