import type { NextResponse } from 'next/server'
import { readSlotImage, writeSlotImage } from '@/lib/clipboard/slotStore'
import { readBodyBounded } from '@/lib/route/boundedBody'
import { byteHeaders, bytesResponse } from '@/lib/route/bytes'
import { guardRequest } from '@/lib/route/guard'
import { apiFail, apiOk } from '@/lib/route/respond'
import {
  MAX_IMAGE_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  tooLargeMessage,
} from '@/lib/uploads/limits'
import { checkUploadRequest } from '@/lib/uploads/request'
import { type ImageFormat, sniffImageFormat } from '@/lib/uploads/sniff/image'

// サーバ経由のクリップボードの画像の口 (docs/114-サーバクリップボード計画.md §2)。
// 文字とメタは /api/clipboard。こちらは画像の生バイトだけを運ぶ。
//
// **デモでは閉じる** (口の理由は api/clipboard/route.ts)。

// クリップボードに載せて他のアプリへ貼れる形式だけ受ける。
// HEIC・AVIF・TIFF は載せても貼り先が読めないことが多く、受け取る側の
// 描き直し (PNG 化) も WebView が読める形に限られる
const MIME_BY_FORMAT: Partial<Record<ImageFormat, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

// 本文を読む前の門に渡す上限。生バイトを送るので multipart の余白は要らないが、
// checkUploadRequest は「上限 - 余白」を断り文に出す作りなので、足して渡して
// 断り文を「最大 10MB」に揃える
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const image = await readSlotImage(guard.user)
  if (image === null) {
    return apiFail('サーバのクリップボードに画像がありません', 404)
  }
  return bytesResponse(
    image.data,
    // 置き直されるたびに中身が変わる口なので、何があっても持たせない
    byteHeaders({ contentType: image.mime, cacheControl: 'no-store', noindex: true }),
  )
}

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const rejection = checkUploadRequest(request, MAX_BODY_BYTES)
  if (rejection) {
    return apiFail(rejection.error, rejection.status)
  }

  // 読みながら数える。Content-Length を申告しない送信 (chunked) は上の事前検査を素通りし、
  // 全部読んでから測ると 1 人でメモリを食い尽くせる (route/boundedBody.ts)
  const bytes = await readBodyBounded(request, MAX_IMAGE_BYTES)
  if (bytes === null) {
    return apiFail(tooLargeMessage(), 413)
  }

  // **申告の Content-Type は信じない。** 中身の署名で形式を決め、その mime で保存する
  // (保存した mime がそのまま GET の Content-Type になる)
  const format = sniffImageFormat(bytes)
  const mime = format === null ? undefined : MIME_BY_FORMAT[format]
  if (mime === undefined) {
    return apiFail('クリップボードに載せられる画像ではありません', 400)
  }

  return apiOk({ slot: await writeSlotImage(guard.user, mime, bytes) })
}
