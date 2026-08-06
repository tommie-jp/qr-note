// 取り込み結果の共通の形 (docs/28-エクスポート計画.md §3 / §4)。
//
// ZIP (lib/zip/importZip.ts) と ENEX (lib/enex/importEnex.ts) は入口も規則も
// 別だが、**利用者に返す報告は 1 つの画面 (components/NotesImporter.tsx) が
// 描く**。3 か所で同じ形を宣言すると、片方に項目を足したときに黙ってずれる。
//
// 型は実行時に消えるので、クライアントからもそのまま import できる。
// **server 専用の依存をこのファイルに持ち込まないこと** (持ち込むと画面から
// 読めなくなる。lib/enex/limits.ts と同じ制約)。

export interface ImportedNote {
  itemNo: string
  // 一覧に出す名前。題名が無いノートもあるので空文字がありうる
  title: string
}

export interface SkippedEntry {
  // 何が取り込めなかったか (「ノート「題名」の添付 dot.png」など)
  label: string
  reason: string
}

// どちらの形式でも必ず返すもの。
//
// **入らなかったものは必ず skipped に載せる**のがこの機能の背骨 — 黙って
// 落とすと、利用者は全ノートを目視するまで欠落に気づけない。
export interface BaseImportReport {
  imported: ImportedNote[]
  // ノート・添付・タグをまとめて 1 本にする。利用者が知りたいのは
  // 「入らなかったものと、その理由」であって、内部の分類ではない
  skipped: SkippedEntry[]
  // 画像検索の索引を作らずに保存した画像の数。黙って作らないと
  // 「取り込んだのに画像検索に出てこない」だけが見えて不具合と区別が付かない
  deferredImageIndex: number
}
