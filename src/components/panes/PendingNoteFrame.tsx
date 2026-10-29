"use client";

import { usePathname } from "next/navigation";
import { SkeletonBox, SkeletonLine } from "@/components/chrome/Skeleton";
import { NoteView } from "@/components/item/NoteView";
import { noteHintStore } from "@/components/panes/noteHint";
import { noteCache } from "@/lib/client/noteStore";
import { itemIdFromPathname } from "@/lib/search/url";

// ノートを読み込んでいる間のペインの中身 (docs/86 §4-18)。
//
// 押した行の題は一覧が既に持っている (noteHint) ので、サーバを待たずに
// 先に出す。本文の場所は骨組みのまま。題が判らないとき (前後の釦・本文の
// リンク・直に URL を打った) は従来どおり骨組みだけ。
//
// **URL の番号と照らしてから出す** — 押した後に別の遷移が割り込むと、
// 前に押した題が別のノートの器に出てしまう
// **控えにノートがあれば、サーバを待たずに本文まで描く** (docs/123 §4-1)。
// 一覧から押したノートは一覧の応答で控えに入っている。行を押すと App Router は
// /item の RSC を取りに行くが、その中身はもう端末が持っているので、往復を
// 待つ理由がない。届いた後の画面 (ItemDetail) も同じ控えから同じ物を描く
export function PendingNoteFrame({ isDemo = false }: { isDemo?: boolean }) {
  const hint = noteHintStore.useStore();
  const pathItemId = itemIdFromPathname(usePathname());
  // 控えに無ければここで取りに行く (RSC と並べて撃つ)
  const cached = noteCache.useEntry(pathItemId)?.value;
  if (pathItemId !== null && cached !== undefined) {
    return <NoteView itemId={pathItemId} isDemo={isDemo} shell="pane" />;
  }
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
