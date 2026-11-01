"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { itemIdFromPathname } from "@/lib/search/url";
import { isValidItemId } from "@/lib/validation";

// 横取りスロット ((search)/@detail/(.)item/[itemId]) の器を出してよいか
// (docs/123 §12-2)。
//
// UUID の番号のノートは ClientNotePane が URL から描くので、スロットは
// 旧番号 (/item/1003) の解決だけを受け持つ。スロットの中身は「合わない URL への
// ソフト遷移では残る」(docs/86 §2) ので、旧番号のノートの後で行を押して
// 端末で別のノートを開くと、古い器が URL に合わないまま残る。
//
//   pathKey あり … URL の番号がその旧番号のときだけ出す
//   pathKey なし … 読み込み中の器。URL が UUID のノートなら出さない
export function DetailSlotGate({
  pathKey,
  children,
}: {
  pathKey?: string;
  children: ReactNode;
}) {
  const pathItemId = itemIdFromPathname(usePathname());
  const show =
    pathKey === undefined
      ? pathItemId === null || !isValidItemId(pathItemId)
      : pathItemId === pathKey;
  return show ? children : null;
}
