import type { NextResponse } from 'next/server'
import { attachSlotThumb, readSlotThumb } from '@/lib/clipboard/slotStore'
import { makeThumbnail } from '@/lib/images/thumbnail'
import { THUMB_MIME } from '@/lib/images/thumbConfig'
import { readBodyBounded } from '@/lib/route/boundedBody'
import { byteHeaders, bytesResponse } from '@/lib/route/bytes'
import { guardRequest } from '@/lib/route/guard'
import { apiFail, apiOk } from '@/lib/route/respond'
import { MAX_VIDEO_THUMB_BYTES, MULTIPART_OVERHEAD_BYTES } from '@/lib/uploads/limits'
import { checkUploadRequest } from '@/lib/uploads/request'
import { isValidVideoThumb } from '@/lib/uploads/sniff/video'

// サーバ経由のクリップボードの見本の絵 (docs/115-サーバクリップボードのサムネ計画.md §2)。
//
// GET … 枠の見本の絵 (WebP)。画像はサーバが置くときに作り、動画・PDF はクライアントが
//       作った絵を PUT で後から貼る
// PUT … クライアントが作った絵を貼る。**必ず makeThumbnail で作り直してから置く**
//       (クライアントのバイト列をそのまま配らない。storeVideo.ts の poster と同じ扱い)。
//       X-Slot-Version (本体の PUT が返したメタの updatedAt) が今の枠と合うときだけ貼る
//
// **デモでは閉じる** (口の理由は api/clipboard/route.ts)。

const VERSION_HEADER = 'x-slot-version'
const TOO_LARGE_MESSAGE = `見本の絵が大きすぎます (最大 ${MAX_VIDEO_THUMB_BYTES / 1024}KB)`
const UNREADABLE_MESSAGE = '見本の絵として読めません'

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const thumb = await readSlotThumb(guard.user)
  if (thumb === null) {
    return apiFail('サーバのクリップボードに見本がありません', 404)
  }
  return bytesResponse(
    thumb,
    byteHeaders({
      contentType: THUMB_MIME,
      // 置き直されるたびに中身が変わる口なので、持たせない
      cacheControl: 'no-store',
      noindex: true,
      extra: { 'Content-Security-Policy': 'sandbox' },
    }),
  )
}

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  // Origin の検査と、Content-Length の事前検査 (断り文はこの口のものにする)
  const rejection = checkUploadRequest(request, MAX_VIDEO_THUMB_BYTES + MULTIPART_OVERHEAD_BYTES)
  if (rejection) {
    return apiFail(rejection.status === 413 ? TOO_LARGE_MESSAGE : rejection.error, rejection.status)
  }

  const version = new Date(request.headers.get(VERSION_HEADER) ?? '')
  if (Number.isNaN(version.getTime())) {
    return apiFail('リクエストの形式が正しくありません', 400)
  }

  // 読みながら数える (chunked でも上限を守る。route/boundedBody.ts)
  const bytes = await readBodyBounded(request, MAX_VIDEO_THUMB_BYTES)
  if (bytes === null) {
    return apiFail(TOO_LARGE_MESSAGE, 413)
  }
  // 画像の署名を持つものだけ (SVG は sniffImageFormat が弾く)
  if (!isValidVideoThumb(bytes)) {
    return apiFail(UNREADABLE_MESSAGE, 400)
  }
  const thumb = await makeThumbnail(bytes, 'clipboard-thumb')
  if (thumb === null) {
    return apiFail(UNREADABLE_MESSAGE, 400)
  }

  const result = await attachSlotThumb(guard.user, version, thumb)
  if (result.status === 'stale') {
    // 見本を作っている間に、別の端末が置き直した。古いファイルの絵は付けない
    return apiFail('サーバのクリップボードが置き直されました', 409)
  }
  if (result.status === 'missing') {
    return apiFail('サーバのクリップボードにファイルがありません', 404)
  }
  return apiOk({ slot: result.meta })
}
