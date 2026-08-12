import Link from "next/link";
import type { MatrixResult } from "@/lib/matrixData";
import type { MatrixCell } from "@/lib/matrixTable";
import { buildItemUrl } from "@/lib/searchUrl";
import { ERROR_SOURCE_CLASS } from "@/components/ui";

interface MatrixTableProps {
  result: MatrixResult;
  // エラー時に「何を書いたか」を出すための元ソース
  code: string;
}

// セルの見え方。**記号と読み上げ文を分ける**のが要点で、記号だけだと
// 読み上げが「チェックマーク」としか言わない (どの列かは判っても、
// 済み / 未 / 項目なし の区別が付かない)。色にも頼らない (docs/58 §3)
const CELL_MARK: Record<MatrixCell, { mark: string; label: string }> = {
  checked: { mark: "✓", label: "済" },
  unchecked: { mark: "☐", label: "未" },
  // その名前の項目がノートに無い。未チェックと区別する (計画 §4)
  absent: { mark: "—", label: "項目なし" },
  untouched: { mark: "☐", label: "未着手" },
  learning: { mark: "◐", label: "学習中" },
  mastered: { mark: "✓", label: "習得" },
};

// 「項目なし」だけ薄く出す。付け忘れは咎めるものではなく気づけばよいもので、
// 未チェック (これから解く物) と同じ濃さだと表の重心が狂う
const CELL_CLASS: Partial<Record<MatrixCell, string>> = {
  absent: "text-gray-300",
};

// ```matrix フェンスを学習状況の表に差し替える
// (docs/77-進捗マトリックス計画.md)。
//
// 集計はサーバ側で済んでいる (buildMatrices) ので、ここは並べるだけ。
// 状態を持たないので "use client" は要らず、オフラインの閲覧
// (クライアント) からも同じ形で描ける。
export function MatrixTable({ result, code }: MatrixTableProps) {
  // 書き方の誤りは「何が悪いか」と元のソースを添えて出す (QuizFence /
  // CircuitDiagram と同じ作法)。黙ってコードブロックに落とさない
  if (result.kind === "error") {
    return (
      <div className="my-4 rounded border border-red-300 bg-red-50 p-3">
        <p className="text-red-700">表の書き方のエラー: {result.error}</p>
        <pre className={ERROR_SOURCE_CLASS}>{code}</pre>
      </div>
    );
  }

  const { table, query, sort } = result;

  // 0 件で空の表を出すと「表が壊れている」ように見える。検索式を添えて
  // 「その検索に当たるノートが無い」と言い切る
  if (table.rows.length === 0) {
    return (
      <p className="my-4 rounded border border-gray-200 bg-gray-50 p-3 text-gray-600">
        チェックを持つノートがありません
        {query && <span className="font-mono">({query})</span>}
      </p>
    );
  }

  return (
    <div className="my-4">
      <p className="mb-1 text-sm text-gray-600">
        {table.total} 件
        {table.columns.map((column, index) => (
          <span key={column} className="ml-3 whitespace-nowrap">
            {column} {table.done[index]}
          </span>
        ))}
      </p>
      {/* 横に溢れる表は帯の中だけでスクロールさせる。**帯は縦のはみ出しも
          切る**ので、ポップアップを持つ物はこの中に置かない (docs/11) */}
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-600">
              {/* w-full + max-w-0 … ノート列が「残り全部」を取って中身を
                  切る。チェックの列は w-px で**自分の文字ぶんだけ**に縮む。
                  こうしないと iPhone (幅 375px) で最後の列が帯の外に出て、
                  横スクロールしないと見えない — 一覧して比べるための表なので、
                  1 画面に収まることを列の並びより優先する */}
              <th scope="col" className="w-full max-w-0 px-4 py-1.5 font-normal">
                ノート
              </th>
              {table.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="w-px px-3 py-1.5 text-center font-normal whitespace-nowrap"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {table.rows.map((row) => (
              <tr key={row.itemNo} className="hover:bg-gray-50">
                <td className="w-full max-w-0 truncate px-4 py-1.5">
                  {/* 検索式と並びをリンクに載せる。開いた先で前後ナビが出て、
                      表 → 1 問目 → 次 → … と回って戻ってこられる
                      (docs/60-学習進捗計画.md §4)。表は入口であって
                      行き止まりではない */}
                  <Link
                    href={buildItemUrl(row.itemNo, query, sort)}
                    className="flex items-baseline gap-2"
                    title={row.summary}
                  >
                    <span className="shrink-0 font-mono font-bold">
                      #{row.itemNo}
                    </span>
                    <span className="min-w-0 truncate text-gray-600">
                      {row.summary}
                    </span>
                  </Link>
                </td>
                {row.cells.map((cell, index) => (
                  <td
                    key={table.columns[index]}
                    className={`w-px px-3 py-1.5 text-center ${CELL_CLASS[cell] ?? ""}`}
                  >
                    <span aria-hidden>{CELL_MARK[cell].mark}</span>
                    <span className="sr-only">{CELL_MARK[cell].label}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.omitted > 0 && (
          // 黙って打ち切ると「これで全部」と読めてしまう
          <p className="border-t border-gray-200 px-4 py-1.5 text-sm text-gray-500">
            他 {table.omitted} 件は表に載せていません(絞り込むと表示されます)
          </p>
        )}
      </div>
    </div>
  );
}
