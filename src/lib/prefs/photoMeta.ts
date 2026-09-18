// 添付した写真の撮影情報 (位置・日時・機種などの EXIF) を、保存するときに
// 消すか残すか (docs/97-写真の撮影情報削除計画.md)。
//
// 既定は**消す**。残したい人だけがハンバーガーメニューの
// 「写真の撮影情報 (EXIF)」で「残す」を選ぶ。効くのはこれから上げる写真だけ。
//
// **このファイルはクライアントからも import される。** prisma や next/headers を
// 持ち込まないこと (読み書きは prefs/photoMetaStore.ts。prefs/rowTint.ts と同じ分け方)。

export type PhotoMetaMode = 'strip' | 'keep'

export const DEFAULT_PHOTO_META_MODE: PhotoMetaMode = 'strip'

// user_settings の key。値は PhotoMetaMode の文字列そのもの
export const PHOTO_META_SETTING_KEY = 'photo-meta'

// **API の入口はこちらを使う** — 知らない値を黙って既定へ寄せると、送り手は
// 保存できたと思い込む (prefs/rowTint.ts の isRowTintId と同じ理由)
export function isPhotoMetaMode(value: unknown): value is PhotoMetaMode {
  return value === 'strip' || value === 'keep'
}

// DB から読んだ値を畳む。知らない値・欠落は**消す**へ倒す — 読めない値で
// 「残す」へ倒れると、利用者の知らないうちに撮影情報が残る
export function parsePhotoMetaMode(value: unknown): PhotoMetaMode {
  return isPhotoMetaMode(value) ? value : DEFAULT_PHOTO_META_MODE
}
