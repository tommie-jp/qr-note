"use client";

import type { ReactNode } from "react";
import { PreviewPane } from "@/components/PreviewPane";
import { usePaneMode } from "@/components/PaneModeProvider";
import { showsAutoNote } from "@/lib/paneMode";

// ノートのペインを持つ構成 (3 / 2) で「まだ何も選んでいないとき」に出る
// 先頭ノートのペイン (docs/86 §4-4)。
// 中身 (検索結果の先頭ノート) はサーバが描いて children で降ろす。
//
// **横取りスロットがノートを持っていたら引っ込む。** あちらは利用者が自分で
// 選んだノートで、こちらは代わりに置いてあるだけなので、居場所を譲る。
// 一度でもノートを開いたら (hasDetail)、以後この自動のペインは出ない。
//
// URL は動かさない。router.replace で /item/<先頭> へ飛ばす手もあるが、
// それだと再読み込みした瞬間に横取りの外 (全画面のノート) へ着地して
// 3 ペインが消える。ここで描けば URL は検索のまま保てる。
export function AutoNotePane({
  bgClass,
  itemNo,
  openHref,
  children,
}: {
  bgClass: string;
  itemNo: string;
  openHref: string;
  children: ReactNode;
}) {
  const { mode, hasDetail } = usePaneMode();

  if (!showsAutoNote(mode) || hasDetail) {
    return null;
  }

  return (
    <PreviewPane
      bgClass={bgClass}
      itemNo={itemNo}
      source="auto"
      openHref={openHref}
    >
      {children}
    </PreviewPane>
  );
}
