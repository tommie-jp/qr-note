import { SECONDARY_BUTTON_CLASS } from "@/components/ui";

// 全ノートを ZIP で書き出す入口 (docs/28-エクスポート計画.md §7)。
//
// **クライアント側の JS を持たない**。素の <form method="post"> なので、
// ブラウザが Content-Disposition をそのままダウンロードとして受ける。
// fetch + blob だと数百 MB のファイルを丸ごとメモリに載せることになり、
// スマホでは開けない。
//
// 選択したぶんだけ書き出す口は検索結果の選択モードにある
// (components/BulkTagToolbar.tsx)。送り先は同じ /api/export。
export function NotesExporter() {
  return (
    <form method="post" action="/api/export" className="space-y-3">
      <p className="text-gray-600">
        すべてのノートを ZIP
        ファイル 1 つにまとめてダウンロードします。中身は 1 ノート 1 枚の
        Markdown (notes/) と、本文が参照する画像・添付 (images/)
        です。テキストエディタや Obsidian でそのまま開けます。
      </p>
      <p className="text-gray-600">
        ゴミ箱のノートは含みません。一部のノートだけ書き出すときは、検索結果で
        「選択」してから「エクスポート」を押して下さい。
      </p>
      <button type="submit" name="scope" value="all" className={SECONDARY_BUTTON_CLASS}>
        ⬇ 全ノートをエクスポート
      </button>
    </form>
  );
}
