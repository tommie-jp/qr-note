// 添付を保存・復元した結果の形と、その組み立て (docs/93-リファクタリング計画.md §4-5)。
// DB にも sharp にも触らない純粋な層なので server-only を付けない。

export const UNSUPPORTED_ATTACHMENT_MESSAGE =
  '対応していない形式です (画像: png/jpg/gif/webp/avif/heic/tiff, 音声: mp3/m4a/wav/webm, 動画: mp4/webm/mov, PDF: pdf, テキスト: txt/csv/md)'

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
