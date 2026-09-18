// storeAttachment の画像分岐 (docs/93-リファクタリング計画.md §4-5)。
// 形式の判定と大きさの検査は store.ts が済ませてから呼ぶ。
import 'server-only'
import { saveImage, type SaveImageOptions } from '@/lib/images/imageStore'
import { normalizeImage, type NormalizedImage } from '@/lib/images/normalizeImage'
import type { ImageFormat } from '@/lib/uploads/sniff/image'
import { applyPhotoMeta, type PhotoMetaSource, resolvePhotoMeta } from './photoMeta'
import { type AttachmentResult, IMAGE_UNREADABLE_MESSAGE, succeed } from './result'

export interface StoreImageOptions extends SaveImageOptions {
  photoMeta: PhotoMetaSource
}

// 画像の保存。HEIC/TIFF は WebP へ変換し、設定が「消す」なら撮影情報を抜いてから
// 保存する (docs/97-写真の撮影情報削除計画.md)。抜くのは正規化の後 — 変換した
// WebP には撮影情報が無いので、抜く相手は素通しの 5 形式だけになる。
export async function storeImage(
  bytes: Uint8Array<ArrayBuffer>,
  format: ImageFormat,
  options: StoreImageOptions,
): Promise<AttachmentResult> {
  // ブラウザが表示できない形式 (HEIC/TIFF) は保存前に WebP へ変換する。
  // 復号に失敗する = 壊れた画像なので断る (500 にはしない)
  let normalized: NormalizedImage
  try {
    normalized = await normalizeImage(bytes, format)
  } catch (error) {
    // 失敗は握り潰さずログに残す (images/thumbnail.ts と同じ流儀)。「特定の 1 枚が
    // 壊れている」のか「HEIC 復号器が丸ごと動いていない」(alpine/musl の
    // イメージ更新後など) のかを、件数と形式で切り分けられるようにする
    console.error(
      `画像の正規化に失敗しました (${format}, ${bytes.byteLength} bytes):`,
      error,
    )
    return { ok: false, reason: IMAGE_UNREADABLE_MESSAGE }
  }

  // 設定はここで引く (画像を保存すると決まってから)。引けない = DB の障害で、
  // 画像のせいではないので 400 に化けさせず例外のまま上げる
  const mode = await resolvePhotoMeta(options.photoMeta)

  // 抜けない = 区画も読めず sharp でも作り直せない壊れた画像。撮影情報が
  // 残ったまま保存するくらいなら断る (§2-3)
  let kept: Uint8Array<ArrayBuffer>
  try {
    kept = await applyPhotoMeta(normalized.bytes, normalized.ext, mode)
  } catch (error) {
    console.error(
      `撮影情報を消せませんでした (${normalized.ext}, ${normalized.bytes.byteLength} bytes):`,
      error,
    )
    return { ok: false, reason: IMAGE_UNREADABLE_MESSAGE }
  }

  const url = await saveImage(kept, normalized.mime, normalized.ext, options)
  return succeed(url, true)
}
