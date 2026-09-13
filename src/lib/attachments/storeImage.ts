// storeAttachment の画像分岐 (docs/93-リファクタリング計画.md §4-5)。
// 形式の判定と大きさの検査は store.ts が済ませてから呼ぶ。
import 'server-only'
import { saveImage, type SaveImageOptions } from '@/lib/imageStore'
import { normalizeImage } from '@/lib/normalizeImage'
import type { ImageFormat } from '@/lib/uploads/sniff/image'
import { type AttachmentResult, succeed } from './result'

// 画像の保存 (HEIC/TIFF は WebP へ変換してから)。
export async function storeImage(
  bytes: Uint8Array<ArrayBuffer>,
  format: ImageFormat,
  options: SaveImageOptions,
): Promise<AttachmentResult> {
  // ブラウザが表示できない形式 (HEIC/TIFF) は保存前に WebP へ変換する。
  // 復号に失敗する = 壊れた画像なので断る (500 にはしない)
  let normalized
  try {
    normalized = await normalizeImage(bytes, format)
  } catch (error) {
    // 失敗は握り潰さずログに残す (thumbnail.ts と同じ流儀)。「特定の 1 枚が
    // 壊れている」のか「HEIC 復号器が丸ごと動いていない」(alpine/musl の
    // イメージ更新後など) のかを、件数と形式で切り分けられるようにする
    console.error(
      `画像の正規化に失敗しました (${format}, ${bytes.byteLength} bytes):`,
      error,
    )
    return {
      ok: false,
      reason: '画像を読み込めませんでした (壊れているか未対応の画像です)',
    }
  }

  const url = await saveImage(
    normalized.bytes,
    normalized.mime,
    normalized.ext,
    options,
  )
  return succeed(url, true)
}
