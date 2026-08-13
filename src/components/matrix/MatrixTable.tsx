import Link from "next/link";
import type { MatrixResult } from "@/lib/matrixData";
import { donePercent, type MatrixCell } from "@/lib/matrixTable";
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

// 済みは緑、未は赤。**記号と併記なので色は補助**だが、9 行の表を縦に見る
// ときは色のほうが速い (docs/58 §3 の「色だけに頼らない」は守ったまま
// 色を足す形)。緑は既存の成功色 (text-emerald-600) に揃える。
//
// 「項目なし」だけ薄い灰色にする。付け忘れは咎めるものではなく気づけば
// よいもので、未チェック (これから解く物) と同じ強さだと表の重心が狂う
const CELL_CLASS: Record<MatrixCell, string> = {
  checked: "text-emerald-600",
  unchecked: "text-red-600",
  absent: "text-gray-300",
  untouched: "text-red-600",
  learning: "text-amber-600",
  mastered: "text-emerald-600",
};

// 回転させた見出しに要る高さ。transform は**レイアウトの箱を変えない**ので、
// 自分で確保しないと文字がはみ出す。CJK は 1 文字 ≒ 1em なので、いちばん長い
// 名前の字数 + 余白で足りる。em で持つのは文字サイズ (docs/61) に追随させるため
function headerHeight(columns: readonly string[]): string {
  const longest = Math.max(...columns.map((column) => [...column].length), 1);
  return `${longest + 1}em`;
}

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
        全 {table.total} 件
        {/* 率を先に、実数を括弧で添える。率だけだと「9 件中の 7」という
            手応えが消え、実数だけだと列どうしを見比べられない */}
        {table.columns.map((column, index) => (
          <span key={column} className="ml-3 whitespace-nowrap">
            {column} {donePercent(table.done[index], table.total)}% (
            {table.done[index]})
          </span>
        ))}
      </p>
      {/* 横に溢れる表は帯の中だけでスクロールさせる。**帯は縦のはみ出しも
          切る**ので、ポップアップを持つ物はこの中に置かない (docs/11) */}
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-600">
              {/* **チェックを先に置く。** 表を開く目的は「どれがまだか」を
                  一目で見ることで、ノートの名前はその次 — 左端に揃っていれば
                  横に目を振らずに縦へ読める。名前を先にすると、幅の狭い画面で
                  真っ先に潰れるはずの名前が場所を先取りしてしまう。
                  w-px … チェックの列は**自分の文字ぶんだけ**に縮む。
                  w-full + max-w-0 … ノート列が「残り全部」を取って中身を切る */}
              {table.columns.map((column) => (
                <th key={column} scope="col" className="w-px p-0 font-normal">
                  {/* 名前を 90° 反時計回りに寝かせて、列の幅を**記号 1 文字**まで
                      狭める (「学習済み」を横書きにすると 1 列で 48px 要る)。
                      読む向きは下から上。
                      **絶対配置にするのが要点** — CSS の rotate は見た目を
                      回すだけでレイアウトの箱を変えないので、流れに置いたまま
                      では横書きのときと同じ幅 (48px) を占め続け、列が狭くならない。
                      流れから外して、器の幅 (w-6) が列幅を決めるようにする */}
                  <div
                    className="relative w-6"
                    style={{ height: headerHeight(table.columns) }}
                  >
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap">
                      {column}
                    </span>
                  </div>
                </th>
              ))}
              <th scope="col" className="w-full max-w-0 px-4 py-1.5 font-normal">
                ノート
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {table.rows.map((row) => (
              // 行を追うための色。灰より青のほうが「いま見ている行」が
              // はっきりする (触る端末には hover が無いので PC 向けの助け)
              <tr key={row.itemNo} className="hover:bg-sky-50">
                {row.cells.map((cell, index) => (
                  <td
                    key={table.columns[index]}
                    className={`w-px px-1 py-1.5 text-center ${CELL_CLASS[cell]}`}
                  >
                    <span aria-hidden>{CELL_MARK[cell].mark}</span>
                    <span className="sr-only">{CELL_MARK[cell].label}</span>
                  </td>
                ))}
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
              </tr>
            ))}
          </tbody>
        </table>
        {(table.omitted > 0 || table.columnsOmitted > 0) && (
          // 黙って打ち切ると「これで全部」と読めてしまう。行も列も同じ扱い
          <p className="border-t border-gray-200 px-4 py-1.5 text-sm text-gray-500">
            {table.omitted > 0 &&
              `他 ${table.omitted} 件は表に載せていません(絞り込むと表示されます)`}
            {table.omitted > 0 && table.columnsOmitted > 0 && " / "}
            {table.columnsOmitted > 0 &&
              `他 ${table.columnsOmitted} 種類のチェックは列にしていません(col= で選べます)`}
          </p>
        )}
      </div>
    </div>
  );
}
