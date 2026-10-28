"use client";

import { usePathname } from "next/navigation";
import { SkeletonBox, SkeletonLine } from "@/components/chrome/Skeleton";
import { noteHintStore } from "@/components/panes/noteHint";
import { itemIdFromPathname } from "@/lib/search/url";

// ノートを読み込んでいる間のペインの中身 (docs/86 §4-18)。
//
// 押した行の題は一覧が既に持っている (noteHint) ので、サーバを待たずに
// 先に出す。本文の場所は骨組みのまま。題が判らないとき (前後の釦・本文の
// リンク・直に URL を打った) は従来どおり骨組みだけ。
//
// **URL の番号と照らしてから出す** — 押した後に別の遷移が割り込むと、
// 前に押した題が別のノートの器に出てしまう
export function PendingNoteFrame() {
  const hint = noteHintStore.useStore();
  const pathItemId = itemIdFromPathname(usePathname());
  const title = hint !== null && hint.itemId === pathItemId ? hint.title : null;

  return (
    <div className="space-y-4" aria-busy="true">
      {title === null ? (
        <SkeletonLine className="w-28" />
      ) : (
        <p className="truncate text-sm text-gray-700">{title}</p>
      )}
      <SkeletonBox className="h-72">ノートを読み込み中…</SkeletonBox>
    </div>
  );
}
