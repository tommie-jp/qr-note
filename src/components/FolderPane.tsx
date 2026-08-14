import Link from "next/link";
import type { ReactNode } from "react";
import { TrashIcon } from "@/components/MenuIcons";
import type { FolderTotals, TagCount } from "@/lib/items";
import { UNTAGGED_TOKEN } from "@/lib/search";
import { normalizeTag, tagSearchHref } from "@/lib/tags";
import type { Sort } from "@/lib/validation";

interface FolderPaneProps {
  tags: TagCount[];
  // 件数と登録パターンは DB を引く後追いの情報 (page.tsx の SearchFolders)。
  // **未指定でも骨組みは描く** — Suspense の fallback にタグだけの
  // ペインを出し、ペインの現れが遅れて一覧が横へ跳ねないようにするため
  // (globals.css の body:has がペインの有無で一覧の幅を変える)
  totals?: FolderTotals;
  trashCount?: number;
  // ☆ で登録した検索パターン (docs/59-検索候補計画.md §7)。スマート
  // フォルダーとしてそのまま並べる — ピン留めの仕組みを新設しない
  // (docs/86 §6)。登録・解除は従来どおり検索窓のドロップダウンで行う
  saved?: string[];
  // 現在の検索状態。どのフォルダーを開いているかはこの 2 つから導く
  // (URL が正・docs/11 §3。選択のための state は持たない)
  query: string;
  sort: Sort;
}

// フォルダーの行き先。検索窓に同じ語を打ったのと同じ `q` 1 つだけの URL に
// する (tagSearchHref と同じ形)。buildSearchUrl を使わないのは意図的 —
// sort を載せず cookie に任せるのと、タグ押下の記録 (tagSearchQuery) が
// 「q 1 つだけの URL」を前提にしているため
function searchHref(query: string): string {
  return `/?q=${encodeURIComponent(query)}`;
}

function FolderRow({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: ReactNode;
  count?: number;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-9 items-center justify-between gap-2 rounded px-2 text-sm ${
          active
            ? "bg-blue-100 font-medium text-blue-800"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1 truncate">{label}</span>
        {count !== undefined && (
          <span className="shrink-0 text-xs text-gray-400">{count}</span>
        )}
      </Link>
    </li>
  );
}

// 検索 3 ペインの左、仮想フォルダー (docs/86 §5)。
//
// フォルダーのテーブルは無い。**どの行もただの検索・並び順へのリンク**で、
// 押した結果は検索窓に同じ語を打ったのと完全に同じ (フォルダーは常に検索の
// エイリアス)。だからノートとの所属がずれる同期問題が構造的に起きない。
//
// xl 未満では出さない (hidden xl:block)。モバイルにはタグ補完と検索履歴が
// 既にあり、ドロワー化は重複投資になる。
// 幅 (--folder-pane-w) はプレビューペインの左端・カード一覧の広幅補正と
// 共有するので globals.css の変数で動かす。
export function FolderPane({
  tags,
  totals,
  trashCount = 0,
  saved = [],
  query,
  sort,
}: FolderPaneProps) {
  // タグ検索の判定は正規化して比べる (#ABC と #abc は同じタグ)
  const normalizedQuery = normalizeTag(query);
  // 「最近」= 空検索のアクセス順 (逆順も含む)。既定の並びは「すべて」
  const isRecent =
    query === "" && (sort === "accessed" || sort === "accessedAsc");

  return (
    // top-12 … sticky ヘッダー (z-20) の下から始める。z-10 は下部バーと同層
    <aside
      data-folder-pane
      aria-label="検索フォルダー"
      className="fixed top-12 bottom-0 left-0 z-10 hidden w-[var(--folder-pane-w)] overflow-y-auto border-r border-gray-200 bg-white/80 px-2 pt-2 pb-16 xl:block"
    >
      <ul className="space-y-0.5">
        <FolderRow
          href="/"
          label="すべて"
          count={totals?.total}
          active={query === "" && !isRecent}
        />
        <FolderRow href="/?sort=accessed" label="最近" active={isRecent} />
        <FolderRow
          href={searchHref(UNTAGGED_TOKEN)}
          label="未分類"
          count={totals?.untagged}
          active={normalizedQuery === UNTAGGED_TOKEN}
        />
        {/* ゴミ箱が空のときは出さない (ヘッダー脇のリンクと同じ判断) */}
        {trashCount > 0 && (
          <FolderRow
            href="/trash"
            label={
              <>
                <TrashIcon small />
                ゴミ箱
              </>
            }
            count={trashCount}
            active={false}
          />
        )}
      </ul>

      {/* ★ の付いた語は検索窓のドロップダウンと同じ物 (最近使った順)。
          タグ検索と重なる登録 (#npn だけ等) では両方の行に印が付くが、
          どちらも同じ検索を指しているので嘘にはならない */}
      {saved.length > 0 && (
        <>
          <h2 className="mt-3 px-2 text-xs font-medium text-gray-400">
            登録パターン
          </h2>
          <ul className="mt-1 space-y-0.5">
            {saved.map((q) => (
              <FolderRow
                key={q}
                href={searchHref(q)}
                label={`★ ${q}`}
                // タグ行と同じ正規化で比べる。生の一致だと、同じ検索に
                // 大小・全角違いで辿り着いたときだけ印が付かない
                active={normalizedQuery === normalizeTag(q)}
              />
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-3 px-2 text-xs font-medium text-gray-400">タグ</h2>
      <ul className="mt-1 space-y-0.5">
        {tags.map((t) => (
          <FolderRow
            key={t.tag}
            href={tagSearchHref(t.tag)}
            label={`#${t.tag}`}
            count={t.count}
            active={normalizedQuery === normalizeTag(`#${t.tag}`)}
          />
        ))}
      </ul>
    </aside>
  );
}
