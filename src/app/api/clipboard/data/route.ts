import type { NextResponse } from 'next/server'
import { IMAGE_UNREADABLE_MESSAGE } from '@/lib/attachments/result'
import { classifySlotFile } from '@/lib/clipboard/slotFile'
import { prepareSlotFile } from '@/lib/clipboard/slotPrepare'
import { readSlotMedia, writeSlotMedia } from '@/lib/clipboard/slotStore'
import { readBodyBounded } from '@/lib/route/boundedBody'
import { byteHeaders, bytesResponse } from '@/lib/route/bytes'
import { guardRequest } from '@/lib/route/guard'
import { apiFail, apiOk } from '@/lib/route/respond'
import {
  MAX_VIDEO_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  tooLargeMessage,
} from '@/lib/uploads/limits'
import { checkUploadRequest } from '@/lib/uploads/request'

// サーバ経由のクリップボードのファイルの口 (docs/114-サーバクリップボード計画.md §2)。
// 文字とメタは /api/clipboard。こちらはファイルの生バイトだけを運ぶ。
//
// 受けるのは、このアプリが添付として扱える形式 (画像・動画・音声・PDF・テキスト)。
// 形式は**中身の署名**で決め (lib/clipboard/slotFile.ts)、申告の Content-Type は見ない。
// ブラウザが読めない写真 (HEIC・TIFF) は JPEG に変換して置く (slotPrepare.ts)。
//
// **デモでは閉じる** (口の理由は api/clipboard/route.ts)。

// 本文を読む前の門に渡す上限。全種別の最大 (動画) に開く。種類ごとの上限 (動画 30MB /
// それ以外 10MB) は、中身を見て形式が決まってから絞る。生バイトを送るので multipart の
// 余白は要らないが、checkUploadRequest は「上限 - 余白」を断り文に出す作りなので、足して
// 渡して断り文を「最大 30MB」に揃える
const MAX_BODY_BYTES = MAX_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES

// 元のファイル名を運ぶヘッダ。テキストの判定 (拡張子でしか txt/csv/md を区別できない) に
// だけ使い、保存はしない。日本語名が通るよう URL エンコードで受ける
const FILE_NAME_HEADER = 'x-file-name'
const MAX_FILE_NAME_LENGTH = 255

const UNSUPPORTED_MESSAGE =
  'この形式のファイルは送れません (画像・動画・音声・PDF・テキストに対応しています)'

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const media = await readSlotMedia(guard.user)
  if (media === null) {
    return apiFail('サーバのクリップボードにファイルがありません', 404)
  }
  return bytesResponse(
    media.data,
    byteHeaders({
      contentType: media.mime,
      // 置き直されるたびに中身が変わる口なので、何があっても持たせない
      cacheControl: 'no-store',
      noindex: true,
      // 保存した mime は固定の表から決めたものだけ (HTML・SVG は置けない)。それでも
      // 直接開かれたときにスクリプトが走る余地を残さない
      extra: { 'Content-Security-Policy': 'sandbox' },
    }),
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
  const bytes = await readBodyBounded(request, MAX_VIDEO_BYTES)
  if (bytes === null) {
    return apiFail(tooLargeMessage(MAX_VIDEO_BYTES), 413)
  }

  // **申告の Content-Type は信じない。** 中身の署名で形式を決め、その mime で保存する
  // (保存した mime がそのまま GET の Content-Type になる)
  const file = classifySlotFile(bytes, fileNameOf(request))
  if (file === null) {
    return apiFail(UNSUPPORTED_MESSAGE, 400)
  }
  // 上限は種類で違う (動画 30MB / それ以外 10MB)。判定は変換前のバイト列に対して行う
  if (bytes.byteLength > file.limit) {
    return apiFail(tooLargeMessage(file.limit), 413)
  }

  let prepared
  try {
    prepared = await prepareSlotFile(file)
  } catch (error) {
    // 壊れた 1 枚か、HEIC 復号器が動いていないのかを切り分けられるよう、ログに残す
    console.error(`クリップボードのファイルを変換できませんでした (${file.mime}, ${bytes.byteLength} bytes):`, error)
    return apiFail(IMAGE_UNREADABLE_MESSAGE, 400)
  }

  return apiOk({ slot: await writeSlotMedia(guard.user, prepared.mime, prepared.data) })
}

// X-File-Name を読む。壊れたエンコード・長すぎる名前は「名前なし」にする
// (テキストと判定できなくなるだけで、他の形式には影響しない)
function fileNameOf(request: Request): string | null {
  const raw = request.headers.get(FILE_NAME_HEADER)
  if (raw === null || raw.length > MAX_FILE_NAME_LENGTH * 3) {
    return null
  }
  try {
    const name = decodeURIComponent(raw)
    return name.length <= MAX_FILE_NAME_LENGTH ? name : null
  } catch {
    return null
  }
}
