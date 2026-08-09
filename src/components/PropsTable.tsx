"use client";

import Link from "next/link";
import { useState } from "react";
import {
  buildPropsTable,
  sortTableRows,
  type ItemPropsRow,
  type PropsSortDir,
} from "@/lib/props";
import { buildItemUrl } from "@/lib/searchUrl";
import type { Sort } from "@/lib/validation";
import { MathText } from "./MathText";

interface PropsTableProps {
  rows: ItemPropsRow[];
  // 上限に達して表から溢れた件数 (0 なら全件載っている)。
  omitted?: number;
  // 表を出している検索状態。行のリンクに載せる — 表は一覧と同じ検索結果を
  // 別の形で見せているので、リンク先も一覧の行と揃っていなければならない。
  // でないと「同じ検索なのに、表から開くと前後ナビが出ない」がおきる
  // (docs/60-学習進捗計画.md §4)。
  //
  // ItemList には出来上がった href を渡しているのに、ここだけ元の値を渡すのは
  // **サーバコンポーネント (page.tsx) が直接描く唯一の一覧だから** —
  // 関数は client 部品の prop として渡せない
  query: string;
  sort: Sort;
  // itemNo → 数式入り要約の KaTeX 済み HTML (docs/69-一覧数式計画.md)。
  // page.tsx (サーバ) が renderInlineMathHtml で作って降ろす。数式の無い行は
  // 入っておらず、プレーンテキスト (row.summary) のまま出す
  mathSummaries?: Record<string, string>;
}

// タグ検索の結果に含まれるプロパティ (hFE=208 など) を並べた特性表。
// 列はヒットしたノートに現れるキーの和集合で、ヘッダをクリックすると
// その列で並べ替える。並べ替え自体は純関数 sortTableRows に委ねる
// (node 環境のテストで挙動を固定できるようにするため)。
export function PropsTable({
  rows,
  omitted = 0,
  query,
  sort,
  mathSummaries,
}: PropsTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<PropsSortDir>("asc");

  const { columns, rows: tableRows } = buildPropsTable(rows);
  // プロパティを持つノートが無いときは表そのものを出さない
  // (page.tsx 側でも絞っているが、単体でも安全に使えるようにする)。
  if (tableRows.length === 0) {
    return null;
  }

  const sorted = sortTableRows(tableRows, sortKey, dir);

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDir("asc");
  };

  return (
    <div className="overflow-x-auto rounded border border-gray-200 bg-white">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-600">
            <th scope="col" className="px-4 py-1.5 font-normal">
              部品
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-4 py-1.5 font-normal whitespace-nowrap"
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className="font-mono hover:underline"
                  aria-label={`${column.label} で並べ替え`}
                >
                  {column.label}
                  {sortKey === column.key && (dir === "asc" ? " ↑" : " ↓")}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {sorted.map((row) => (
            <tr key={row.itemNo} className="hover:bg-gray-50">
              <td className="px-4 py-1.5">
                {/* 部品名は長くなりがちなので幅を抑えて省略する。抑えないと
                    横スクロールの表で hFE などの列が画面外へ押し出され、
                    「並べて比べる」という表の目的が崩れる (特にスマホ)。 */}
                <Link
                  href={buildItemUrl(row.itemNo, query, sort)}
                  className="flex max-w-56 items-baseline gap-2"
                  title={row.summary}
                >
                  <span className="shrink-0 font-mono font-bold">#{row.itemNo}</span>
                  {/* ツールチップ (title 属性) は上でプレーンテキストのまま。
                      属性に HTML は入らないので、数式は表示側だけ KaTeX にする */}
                  <span className="min-w-0 truncate text-gray-600">
                    {mathSummaries?.[row.itemNo] ? (
                      <MathText html={mathSummaries[row.itemNo]} />
                    ) : (
                      row.summary
                    )}
                  </span>
                </Link>
              </td>
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-1.5 font-mono whitespace-nowrap">
                  {row.cells[column.key] ?? (
                    // 値が無いことを空白と区別できるようにする。
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {omitted > 0 && (
        // 黙って打ち切ると「これで全部」と読めてしまう。表は並べて比べるための
        // ものなので、載っていない部品があることは必ず知らせる。
        <p className="border-t border-gray-200 px-4 py-1.5 text-sm text-gray-500">
          他 {omitted} 件は表に載せていません(絞り込むと表示されます)
        </p>
      )}
    </div>
  );
}
