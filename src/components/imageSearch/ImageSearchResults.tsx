"use client";

import Link from "next/link";
import { thumbUrl } from "@/lib/images/memoImages";
import type { ItemMatch } from "@/lib/embedding/imageSearch";

// 画像検索の候補一覧 (docs/25-画像検索計画.md §6)。押すとそのノートへ飛び、
// 画像検索の画面を閉じる
export function ImageSearchResults({
  matches,
  searched,
  live,
  onSelect,
}: {
  matches: ItemMatch[];
  searched: boolean;
  live: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="w-full max-w-md">
      {/* ライブ中はフレームごとに結果が入れ替わるので「見つからず」を出すと
          チラつく。シャッター/写真での確定検索のときだけ出す */}
      {searched && !live && matches.length === 0 && (
        <p className="py-4 text-center text-white/70">
          似ているノートが見つかりませんでした。
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {matches.map((m) => (
          <li key={m.itemNo}>
            <Link
              href={`/item/${m.itemNo}`}
              onClick={onSelect}
              className="flex items-center gap-3 rounded bg-white/10 p-2 transition-colors active:bg-white/20"
            >
              {/* 一覧と同じサムネ配信を使う */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl(m.imageName)}
                alt=""
                className="h-14 w-14 flex-shrink-0 rounded object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.title}</span>
                <span className="block text-sm text-white/60">
                  {m.itemNo}・一致度 {Math.round(m.score * 100)}%
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
