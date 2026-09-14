// storeAttachment の動画分岐 (41-QR-search/docs/14-動画挿入計画.md、
// docs/93-リファクタリング計画.md §4-5)。形式の判定は store.ts が済ませてから呼ぶ。
// 動画だけは共通の 10MB 検査の前に来るので、大きさ (30MB) はここで見る。
import 'server-only'
import { savePlainAttachment } from '@/lib/images/imageStore'
import { moveMoovToFront } from '@/lib/video/mp4Faststart'
import { makeThumbnail } from '@/lib/images/thumbnail'
import { MAX_VIDEO_BYTES, tooLargeMessage } from '@/lib/uploads/limits'
import {
  isValidVideoAnimFrame,
  isValidVideoThumb,
  type VideoFormat,
  videoSaveInfo,
} from '@/lib/uploads/sniff/video'
import { makeVideoAnim } from '@/lib/video/videoAnim'
import { type AttachmentResult, succeed } from './result'

// 動画のときだけ使う、クライアントが作ったサムネの材料。
// store.ts の StoreAttachmentOptions がこれを引き継ぐ。
export interface VideoThumbSources {
  // 動画の poster に使う WebP サムネ。クライアントが先頭フレームから作って
  // 同じ POST で送る (41-QR-search/docs/14 §Phase3)。**動画と判定されたときだけ**使い、
  // WebP かつ 200KB 以下でなければ捨てる (isValidVideoThumb)。無ければ
  // poster なしで保存する (配信側が 404 を返し、ブラウザは poster を無視する)。
  // ENEX インポートなど動画を伴わない経路では渡らない。
  videoThumb?: Uint8Array<ArrayBuffer> | null

  // 動くサムネ (アニメーション WebP) の材料になるコマ
  // (docs/72-動画アニメサムネ計画.md)。videoThumb と同じく**動画と判定された
  // ときだけ**使い、1 枚ずつ isValidVideoAnimFrame で検査してから束ねる。
  //
  // videoThumb と分けて受けるのは、静止 poster と動くサムネの成否を独立させる
  // ため。コマの抽出は端末とコーデック次第で途中で打ち切られるので、
  // 「静止は作れたがアニメは作れない」は正常な結果として起こる。
  videoFrames?: Uint8Array<ArrayBuffer>[]
}

export async function storeVideo(
  bytes: Uint8Array<ArrayBuffer>,
  format: VideoFormat,
  sources: VideoThumbSources,
): Promise<AttachmentResult> {
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    return { ok: false, reason: tooLargeMessage(MAX_VIDEO_BYTES) }
  }
  // 動画も素通し保存。mp4/mov は moov を先頭へ移す (音声の m4a と同じ理由で、
  // 末尾 moov のままだと <video preload="metadata"> が再生を始められない)。
  // webm は ISO-BMFF ではないので moveMoovToFront が null を返す = 素通し。
  const { mime, ext } = videoSaveInfo(format)
  const stored =
    format === 'webm' ? bytes : (moveMoovToFront(bytes) ?? bytes)
  // クライアント生成の poster は**そのまま保存しない**。まず安い検査
  // (WebP かつ 200KB 以下) で弾き、通ったものも sharp で作り直す — 画像の
  // サムネと同じ経路 (makeThumbnail) に通すことで、解凍爆弾よけ
  // (MAX_INPUT_PIXELS) を効かせ、閲覧側のブラウザを巨大 WebP で落とせない
  // ようにする。作れなければ poster 無しで保存する (配信側が 404 を返す)。
  const thumb =
    sources.videoThumb && isValidVideoThumb(sources.videoThumb)
      ? await makeThumbnail(sources.videoThumb, 'video poster')
      : null
  // 動くサムネ (docs/72-動画アニメサムネ計画.md)。**静止 poster とは独立に
  // 判定する** — コマの抽出は端末とコーデック次第で途中で打ち切られるので、
  // 「静止は作れたがアニメは作れない」が普通に起こる。ここで巻き添えにすると
  // 一覧から絵が消える (13-kick-work の make_assets と同じ考え方)
  const thumbAnim = await makeVideoAnim(
    (sources.videoFrames ?? []).filter(isValidVideoAnimFrame),
    'video anim',
  )
  return succeed(
    await savePlainAttachment(stored, mime, ext, { thumb, thumbAnim }),
    false,
  )
}
