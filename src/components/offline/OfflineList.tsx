"use client";

import { RowThumb } from "@/components/RowThumb";
import { firstThumbInfo } from "@/lib/memoImages";
import { memoSummary } from "@/lib/memoSummary";
import type { OfflineItem } from "@/lib/offline/item";

interface OfflineListProps {
  items: readonly OfflineItem[];
  // ノートを開く。**Link ではなくボタンで受ける**のがこの画面の要点 —
  // App Router の画面遷移は RSC ペイロードを取りに行くので、圏外では必ず
  // 失敗する。/offline の中で query を書き換えるだけにする (params.ts)
  onOpen: (itemNo: string) => void;
}

// オフラインの検索結果 (docs/65-オフライン対応計画.md §3-4)。
//
// 見た目は ItemRow の compact に寄せてあるが、**別物として書いてある**。
// あちらは Prisma の Item を受け、選択モード・スワイプ削除・Server Action の
// リンクを持つ — 圏外ではどれも動かない物ばかりで、共有すると「押せるのに
// 何も起きない」箇所が増える。ここは開くことしかできない一覧でよい。
export function OfflineList({ items, onOpen }: OfflineListProps) {
  if (items.length === 0) {
    return (
      <p className="rounded border border-gray-200 bg-white px-4 py-6 text-center text-gray-500">
        一致するノートがありません
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-200 overflow-hidden rounded border border-gray-200 bg-white">
      {items.map((item) => {
        const isUrl = item.mode === "url";
        const title = isUrl ? item.url : memoSummary(item.memo);
        const thumb = isUrl ? null : firstThumbInfo(item.memo);

        return (
          <li key={item.itemNo}>
            {/* 行全体を 1 つのボタンにする。ItemRow のように中にタグの
                リンクを置かない (タグ検索も圏外では別ページになる) ので、
                入れ子の心配が無く stretched link の小細工も要らない */}
            <button
              type="button"
              onClick={() => onOpen(item.itemNo)}
              className="flex w-full items-baseline gap-3 px-4 py-1.5 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <span className="shrink-0 font-mono font-bold">#{item.itemNo}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gray-600">{title}</span>
                {item.tags.length > 0 && (
                  <span className="block truncate text-sm text-blue-700">
                    {item.tags.map((tag) => `#${tag}`).join(" ")}
                  </span>
                )}
              </span>
              {thumb && (
                <RowThumb
                  name={thumb.name}
                  isVideo={thumb.isVideo}
                  sizePx={40}
                  sizeClass="size-10"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
