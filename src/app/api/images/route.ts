import type { NextResponse } from 'next/server'
import { storeAttachment } from '@/lib/attachments/store'
import { checkDemoUploadQuota } from '@/lib/demo/demoQuota'
import { guardRequest } from '@/lib/route/guard'
import { parseFormBody } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'
import {
  maxAttachmentBytes,
  MAX_VIDEO_ANIM_FRAME_BYTES,
  MAX_VIDEO_ANIM_FRAMES,
  MAX_VIDEO_THUMB_BYTES,
  maxUploadBytes,
  megabytesLabel,
  tooLargeMessage,
} from '@/lib/uploads/limits'
import { checkUploadRequest } from '@/lib/uploads/request'

// memo エディタからの画像アップロード。UUID 名で images テーブルに保存し、
// 参照用の URL (/api/images/<name>) を返す。
//
// 形式の判定・変換・保存そのものは attachments/store.ts が持つ (ENEX インポートと
// 共有する)。ここに残すのは HTTP の作法 — 認証・CSRF・大きさ・応答の組み立て。
export async function POST(request: Request): Promise<NextResponse> {
  // 一番先に見る。ログインしていない相手のために本文を読む理由はない
  // (31MB まで受け取ってから断るのは、断り方として無駄が大きい)
  //
  // 第三者のページからの呼び出し (Sec-Fetch-Site) も本文の前に断る。下の
  // checkUploadRequest の Origin 検査と役目は重なる — Sec-Fetch-Site を送る
  // ブラウザは POST に必ず Origin も付けるので、ここで増えて断る正規の要求は
  // ない。それでも他の口と同じ門番を通し、口ごとの流儀の差を作らない
  // (docs/18 §9、判定の理由は auth/crossSite.ts)
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }

  const rejection = checkUploadRequest(request)
  if (rejection) {
    return apiFail(rejection.error, rejection.status)
  }

  // 読めなければ 400 を返すが原因はログに残す (parseFormBody。api/import と同じ理由)
  const form = await parseFormBody(
    request,
    {
      log: 'アップロードの multipart 解析に失敗しました:',
      // **「書き方が悪い」とだけ言わない。** ここへ来る現実の原因はほとんどが
      // 「本文が最後まで届かなかった」で、その筆頭が大きすぎるファイルである。
      // Content-Length を申告する普通の送信は上の checkUploadRequest が 413 で
      // 断るが、申告しない送信 (chunked) はそこを素通りし、Next.js の proxy が
      // 複製できる量 (next.config.ts の proxyClientMaxBodySize) で黙って切られて
      // ここへ落ちてくる。大きさの目安を添えて、次に何を疑えばよいか分かるように
      // する — かつてこの文言のせいで、上限超えの動画が「multipart の書き方の
      // 問題」に見えていた
      message:
        'アップロードに失敗しました (本文が最後まで届きませんでした)。' +
        `ファイルが大きすぎる可能性があります (最大 ${megabytesLabel(maxUploadBytes())})`,
    },
  )
  if (!form.ok) {
    return form.response
  }
  const file = form.value.get('file')
  // 動画のときだけ付く poster 用 WebP (クライアント生成)。中身の検証は
  // attachments/storeVideo.ts が行うので、ここでは有無だけ拾う (41-QR-search/docs/14 §Phase3)
  const thumbField = form.value.get('thumb')
  // 動くサムネの材料になるコマ (docs/72-動画アニメサムネ計画.md)。
  // 同じ名前で複数付くので getAll で受ける
  const frameFields = form.value.getAll('thumbFrames')

  if (!(file instanceof File)) {
    return apiFail('file フィールドがありません', 400)
  }

  // 原寸を Uint8Array に読む前に、申告サイズで弾けるものは弾く。
  // 上限はデモインスタンスでは縮む (docs/38 §5。maxUploadBytes が env で切り替え)
  if (file.size > maxUploadBytes()) {
    return apiFail(tooLargeMessage(maxUploadBytes()), 400)
  }

  // デモの総量クォータ (docs/39-デモ公開計画.md §2-1)。デモのときだけ、
  // 保存前に images の総バイト数を見て上限超過なら 507 で断る。DB を引くので
  // 認証・CSRF・サイズの安い検査をすべて通した後に置く
  const quota = await checkDemoUploadQuota(file.size)
  if (quota) {
    return apiFail(quota.error, quota.status)
  }

  // 動画の poster (WebP) が付いていれば読む。動画以外では無視される
  // (attachments/storeVideo.ts が動画判定時のみ使い、WebP・200KB 以下だけを採用する)。
  // **バッファする前に申告サイズで弾く** — 上限超過の thumb はメモリに読まず
  // poster 無しとして扱う (本体の動画は通す)。中身の再検証は attachments/storeVideo.ts。
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
  // attachments/storeVideo.ts が MAX_VIDEO_BYTES で別に絞る
  const stored = await storeAttachment(new Uint8Array(await file.arrayBuffer()), {
    fileName: file.name,
    maxBytes: maxAttachmentBytes(),
    videoThumb,
    videoFrames,
  })
  if (!stored.ok) {
    return apiFail(stored.reason, 400)
  }

  return apiOk({ url: stored.url }, 200)
}
