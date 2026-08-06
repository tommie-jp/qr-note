// ZIP 1 ファイルの上限 (docs/28-エクスポート計画.md §3)。
//
// **クライアントとサーバの両方から import する**ためにここへ切り出す
// (lib/enex/limits.ts と同じ理由)。server 専用の依存を持つファイルに置くと、
// 取り込み画面 (NotesImporter) から読めない。

// アップロードできる .zip の大きさ。ENEX と同じ枠に揃える。
//
// **エッジ (Caddyfile / deploy/nginx) のボディ上限 12MB がこれと multipart の
// 余白を賄っている**ので、上げるときはあちらも一緒に上げること。片方だけ
// 上げると、アプリに届く前に 413 で切られてブラウザには "Load failed" としか
// 出ない (サーバの JSON エラーは届かない)。
//
// **全ノートの復元をこの口で賄うつもりはない**。全件バックアップは pg_dump が
// 担っており (§冒頭)、この口の用途は「一部を書き出して手元で直して戻す」
// である。選択エクスポート (§7) の ZIP はこの枠に十分収まる。
export const MAX_ZIP_BYTES = 10 * 1024 * 1024

// 展開後の合計の上限 (ZIP 爆弾よけ)。
//
// **入口が 10MB でも出口は無限になりうる**のが ZIP 爆弾で、ゼロ埋めの
// ファイルは 1000 倍に膨らむ。一方、本物の書き出しは中身の大半が
// 圧縮済みの添付 (jpg/webp/mp4) なので、展開しても入口とほとんど変わらない。
// つまり 6 倍まで許せば正規のファイルは全部通り、爆弾は止まる。
//
// 本番 VPS は RAM 2GB / swap 常用 (docs/09) なので、この値がそのまま
// 「取り込み中に載る最大量」になることも見て決めている。
export const MAX_ZIP_TOTAL_BYTES = 60 * 1024 * 1024

// 展開後の 1 ファイルの上限。動画の上限 (uploads.ts の MAX_VIDEO_BYTES) と
// 同じにする — これより大きい添付はそもそも保存されていない
export const MAX_ZIP_FILE_BYTES = 30 * 1024 * 1024

// ZIP に入っていてよい項目数 (ノートと添付の合計)。
//
// 細工したファイルで延々とループを回されないための安全弁 (ENEX の
// MAX_NOTES_PER_IMPORT と同じ役割) だが、**この値は fflate の実測から決めた**。
// fflate の Unzip は項目ごとに再帰するため、手元で測ると 3000 件は通り
// 3500 件で `RangeError: Maximum call stack size exceeded` になる。
// 落ちてから気づくのではなく、その手前で理由を言って断る。
//
// 2000 に置くのは、上限に当たったことを**こちらの言葉で**伝えられる範囲に
// 留めるため (3000 に寄せると実装差で落ちる側に倒れうる)。全ノートの復元を
// この口で賄うつもりがないのは MAX_ZIP_BYTES と同じ理由。
export const MAX_ZIP_ENTRIES = 2000

export function zipTooLargeMessage(actualBytes: number): string {
  const actual = (actualBytes / 1024 / 1024).toFixed(1)
  const limit = MAX_ZIP_BYTES / 1024 / 1024
  return (
    `ファイルが大きすぎます (${actual}MB / 上限 ${limit}MB)。` +
    'ノートを分けて書き出してから取り込んで下さい'
  )
}
