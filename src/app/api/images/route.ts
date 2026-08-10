import { NextResponse } from 'next/server'
import { denyUnlessLoggedIn } from '@/lib/apiAuth'
import { storeAttachment } from '@/lib/attachmentStore'
import { checkDemoUploadQuota } from '@/lib/demoQuota'
import {
  checkUploadRequest,
  maxAttachmentBytes,
  MAX_VIDEO_ANIM_FRAME_BYTES,
  MAX_VIDEO_ANIM_FRAMES,
  MAX_VIDEO_THUMB_BYTES,
  maxUploadBytes,
  tooLargeMessage,
} from '@/lib/uploads'

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, data: null, error }, { status })
}

// memo エディタからの画像アップロード。UUID 名で images テーブルに保存し、
// 参照用の URL (/api/images/<name>) を返す。
//
// 形式の判定・変換・保存そのものは attachmentStore.ts が持つ (ENEX インポートと
// 共有する)。ここに残すのは HTTP の作法 — 認証・CSRF・大きさ・応答の組み立て。
export async function POST(request: Request): Promise<NextResponse> {
  // 一番先に見る。ログインしていない相手のために本文を読む理由はない
  // (12MB まで受け取ってから断るのは、断り方として無駄が大きい)
  const denied = await denyUnlessLoggedIn()
  if (denied) {
    return denied
  }

  const rejection = checkUploadRequest(request)
  if (rejection) {
    return errorResponse(rejection.status, rejection.error)
  }

  let file: FormDataEntryValue | null
  let thumbField: FormDataEntryValue | null = null
  let frameFields: FormDataEntryValue[] = []
  try {
    const formData = await request.formData()
    file = formData.get('file')
    // 動画のときだけ付く poster 用 WebP (クライアント生成)。中身の検証は
    // attachmentStore が行うので、ここでは有無だけ拾う (docs/14 §Phase3)
    thumbField = formData.get('thumb')
    // 動くサムネの材料になるコマ (docs/72-動画アニメサムネ計画.md)。
    // 同じ名前で複数付くので getAll で受ける
    frameFields = formData.getAll('thumbFrames')
  } catch (error) {
    // 400 を返すが原因はログに残す。multipart の書き方だけでなく、途中で切れた
    // 通信や境界を書き換えるプロキシもここへ来るため (api/import と同じ理由)
    console.error('アップロードの multipart 解析に失敗しました:', error)
    return errorResponse(400, 'multipart/form-data で file を送信して下さい')
  }

  if (!(file instanceof File)) {
    return errorResponse(400, 'file フィールドがありません')
  }

  // 原寸を Uint8Array に読む前に、申告サイズで弾けるものは弾く。
  // 上限はデモインスタンスでは縮む (docs/38 §5。maxUploadBytes が env で切り替え)
  if (file.size > maxUploadBytes()) {
    return errorResponse(400, tooLargeMessage(maxUploadBytes()))
  }

  // デモの総量クォータ (docs/39-デモ公開計画.md §2-1)。デモのときだけ、
  // 保存前に images の総バイト数を見て上限超過なら 507 で断る。DB を引くので
  // 認証・CSRF・サイズの安い検査をすべて通した後に置く
  const quota = await checkDemoUploadQuota(file.size)
  if (quota) {
    return errorResponse(quota.status, quota.error)
  }

  // 動画の poster (WebP) が付いていれば読む。動画以外では無視される
  // (attachmentStore が動画判定時のみ使い、WebP・200KB 以下だけを採用する)。
  // **バッファする前に申告サイズで弾く** — 上限超過の thumb はメモリに読まず
  // poster 無しとして扱う (本体の動画は通す)。中身の再検証は attachmentStore。
  const videoThumb =
    thumbField instanceof File &&
    thumbField.size > 0 &&
    thumbField.size <= MAX_VIDEO_THUMB_BYTES
      ? new Uint8Array(await thumbField.arrayBuffer())
      : null

  // 動くサムネのコマ。poster と同じく**バッファする前に枚数と申告サイズで
  // 切る** — ここを素通しさせると、コマを何百枚も付けた 1 回の POST で
  // メモリを潰せる。上限を超えたぶんは黙って捨て、動画本体は通す
  // (動くサムネは無くても静止サムネで一覧は成立する)
  const videoFrames = await Promise.all(
    frameFields
      .filter(
        (field): field is File =>
          field instanceof File &&
          field.size > 0 &&
          field.size <= MAX_VIDEO_ANIM_FRAME_BYTES,
      )
      .slice(0, MAX_VIDEO_ANIM_FRAMES)
      .map(async (field) => new Uint8Array(await field.arrayBuffer())),
  )

  // ファイル名を渡すのはテキスト (txt/csv/md) の拡張子を決めるためだけ。
  // 名前そのものは保存名にならない (サーバ発番の UUID + 既知の拡張子)。
  // maxBytes は動画以外の 1 ファイル上限 (デモでは 2MB)。動画は
  // attachmentStore が MAX_VIDEO_BYTES で別に絞る
  const stored = await storeAttachment(new Uint8Array(await file.arrayBuffer()), {
    fileName: file.name,
    maxBytes: maxAttachmentBytes(),
    videoThumb,
    videoFrames,
  })
  if (!stored.ok) {
    return errorResponse(400, stored.reason)
  }

  return NextResponse.json({
    success: true,
    data: { url: stored.url },
    error: null,
  })
}
