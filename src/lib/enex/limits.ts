// ENEX 1 ファイルの上限 (docs/28-エクスポート計画.md §4)。
//
// **クライアントとサーバの両方から import する**ためにここへ切り出す。
// server 専用の依存 (prisma / node:crypto) を持つファイルに置くと、
// クライアント (NotesImporter) から読めない。
//
// クライアントでも検査する理由: 上限を超えたファイルはエッジ (nginx / Caddy)
// が 413 でボディを読み捨てるため、ブラウザからは送信中に接続が切れたように
// 見え、fetch が "Load failed" で失敗する。サーバの JSON エラーは届かないので、
// **送る前に**サイズを見て理由を言葉で出すしかない。
//
// 画像アップロードと同じ枠にする。**エッジ (Caddyfile / deploy/nginx) の
// ボディ上限 12MB がこれと multipart の余白を賄っている**ので、この値を上げる
// ときはあちらも一緒に上げること。片方だけ上げると、アプリに届く前に 413 で
// 切られてブラウザには "Load failed" としか出ない (サーバの JSON エラーは届かない)。
//
// **大きい ENEX は Web からは入れない**。変換は入力に比例してメモリを食い、
// 本番 VPS は RAM 2GB で swap を常用している (docs/09-vps振り分け移行手順.md)。
// 実データの書き出しは 40.2MB あり、これはローカル (WSL) から
// ./doImportEnex.sh で取り込む。Web の口は「スマホから小さいものを入れる」用途に
// 絞り、エッジの防波堤を下げない (docs/28-エクスポート計画.md §4)。
export const MAX_ENEX_BYTES = 10 * 1024 * 1024

// CLI (scripts/importEnex.ts) で受け付ける添付 1 件の上限。
//
// Web の口が使う 10MB (uploads.ts の MAX_IMAGE_BYTES) は、エッジのボディ上限
// 12MB に収まる大きさとして決めたもので、**DB に置ける大きさの上限ではない**。
// ファイルから直接読む CLI は HTTP を通らないので、その制限を持ち込まない。
//
// iPhone の写真は 10MB を普通に超える (手元の書き出しでは 10 枚中 3 枚が
// 11〜12MB)。ここで弾くと移行のたびに写真が虫食いになる。
//
// 縮小はしない。移行は一方通行なので、元の解像度を黙って落とすより
// そのまま入れて、必要になってから間引くほうが取り返しがつく。
// 青天井にしないのは、細工したファイルで巨大な行を作られないため
export const MAX_CLI_ATTACHMENT_BYTES = 50 * 1024 * 1024

// CLI が読み込める 1 ファイルの上限。
//
// Node は 1 つの文字列を 512MB (`buffer.constants.MAX_STRING_LENGTH`) までしか
// 持てない。readFileSync(path, 'utf8') はファイル全体を 1 つの文字列にするので、
// 512MB を超える .enex は変換以前に `ERR_STRING_TOO_LONG` で落ちる。
// **その意味不明なエラーを見せる前に**、余白を取った 400MB で断って
// 「選択を分けて書き出し直す」よう案内する (docs/13-EVERNOTE全ノート移行メモ.md)。
export const MAX_CLI_ENEX_BYTES = 400 * 1024 * 1024

// このタグを ENEX 由来の全ノートに必ず付ける (docs/28-エクスポート計画.md §4)。
//
// **由来の印**。移行に不満が出たとき「#evernote で全選択 → ゴミ箱」で
// やり直せるようにするのが狙い。要らなくなれば一括タグ削除で外せる。
// enex ではなく evernote にしたのは、後から探すとき頭に浮かぶのは
// ファイル形式ではなくサービス名だから。
export const EVERNOTE_TAG = 'evernote'

export function enexTooLargeMessage(actualBytes: number): string {
  const actual = (actualBytes / 1024 / 1024).toFixed(1)
  const limit = MAX_ENEX_BYTES / 1024 / 1024
  return (
    `ファイルが大きすぎます (${actual}MB / 上限 ${limit}MB)。` +
    '大きいファイルは PC 上で ./doImportEnex.sh から取り込むか、' +
    'Evernote 側でノートブックを分けて書き出して下さい'
  )
}
