// 保存と復元の両方で使う「設定どおりに撮影情報を消す」一手
// (docs/97-写真の撮影情報削除計画.md §2-4)。抜き方そのものは images/photoMeta/ が持つ。
import 'server-only'
import { isPhotoFormat, stripPhotoMeta } from '@/lib/images/photoMeta'
import type { PhotoMetaMode } from '@/lib/prefs/photoMeta'

// 設定の値か、値を引く関数。アップロードの口 (api/images) は関数で渡す —
// 中身を見て断る経路 (画像でない・偽装) で DB (user_settings) を引かないため。
// その口のテストは「DB に触れる前に弾く」を契約にしている
export type PhotoMetaSource = PhotoMetaMode | (() => Promise<PhotoMetaMode>)

export async function resolvePhotoMeta(source: PhotoMetaSource): Promise<PhotoMetaMode> {
  return typeof source === 'function' ? source() : source
}

// ext は保存名の拡張子 (正規化の後)。画像はこの時点で必ず素通しの 5 形式の
// どれかになっている (HEIC / TIFF は WebP へ変換済み)。
//
// 抜けなければ例外 — 呼ぶ側が「読み込めませんでした」で断る
export async function applyPhotoMeta(
  bytes: Uint8Array<ArrayBuffer>,
  ext: string,
  mode: PhotoMetaMode,
): Promise<Uint8Array<ArrayBuffer>> {
  if (mode === 'keep') {
    return bytes
  }
  // 知らない拡張子を素通しにしない。ここへ来るなら判定側の不具合
  if (!isPhotoFormat(ext)) {
    throw new Error(`撮影情報を消せない形式です (${ext})`)
  }
  return stripPhotoMeta(bytes, ext)
}
