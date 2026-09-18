// 添付を保存・復元した結果の形と、その組み立て (docs/93-リファクタリング計画.md §4-5)。
// DB にも sharp にも触らない純粋な層なので server-only を付けない。

export const UNSUPPORTED_ATTACHMENT_MESSAGE =
  '対応していない形式です (画像: png/jpg/gif/webp/avif/heic/tiff, 音声: mp3/m4a/wav/webm, 動画: mp4/webm/mov, PDF: pdf, テキスト: txt/csv/md/s1p/s2p)'

// 形式の判定は通ったが復号できなかった画像 (保存と復元で同じ文言にする)
export const IMAGE_UNREADABLE_MESSAGE = '画像を読み込めませんでした (壊れているか未対応の画像です)'

// 動画の撮影情報を消せなかった (箱の並びが読めない)。動画は作り直す手段を
// 持たないので断る (docs/97 §10)。
//
// 「残す」にすれば保存できる、という案内はここに書かない。この文言は CLI の取り込み
// (旗は --keep-photo-meta) やデモ (メニューに出ない) とも共有するので、案内が
// 通じるのは画面から上げたときだけ。画面の口 (api/images) が
// VIDEO_META_KEEP_HINT を足す
export const VIDEO_META_FAILED_MESSAGE =
  '動画の撮影情報を消せませんでした (壊れているか未対応の形です)'

export const VIDEO_META_KEEP_HINT =
  'メニューの「写真の撮影情報 (EXIF)」を「残す」にすると保存できます'

export type AttachmentResult =
  | {
      ok: true
      // 本文から参照する URL (/api/images/<name>)
      url: string
      // 保存名。取り消し (インポートの巻き戻し) で行を消すために返す
      name: string
      // 画像なら本文に ![](url) で貼れる。音声・PDF はリンクにする
      isImage: boolean
    }
  | { ok: false; reason: string }

export type RestoreResult =
  // created=false は「同じ名前の行が既にある」= 二度目の取り込み
  | { ok: true; created: boolean }
  | { ok: false; reason: string }

export function succeed(url: string, isImage: boolean): AttachmentResult {
  return { ok: true, url, name: url.slice(url.lastIndexOf('/') + 1), isImage }
}

export function mismatch(ext: string): RestoreResult {
  return {
    ok: false,
    reason: `中身が拡張子 (.${ext}) と一致しません`,
  }
}
