// メニューへのドロップで、送るファイルを 1 つ決める (docs/114-サーバクリップボード計画.md)。
// 枠は 1 つなので複数は受けない。ドラッグ中に「ファイルか」を見る判定は
// editor/dropFiles.ts の hasDroppedFiles を使う (同じ "Files" の見方)。

export type DroppedFile = { readonly file: File } | { readonly error: string } | null

export function pickDroppedFile(files: ArrayLike<File>): DroppedFile {
  if (files.length === 0) {
    return null
  }
  if (files.length > 1) {
    return { error: 'ファイルは 1 つずつ送ってください (サーバの枠は 1 つです)' }
  }
  return { file: files[0] as File }
}
