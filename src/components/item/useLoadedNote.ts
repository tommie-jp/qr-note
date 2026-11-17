"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Item } from "@/generated/prisma/client";
import { recordHealthAction, toggleMemoTaskAction } from "@/lib/client/actions";
import { renderCache } from "@/lib/client/noteStore";
import { HEALTH_LANG, MATRIX_LANG } from "@/lib/markdown/fenceLanguages";
import { notePaneLayout } from "@/lib/prefs/paneMode";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { noteTabsFor } from "@/modules/registry";

// /item の画面 (NoteView の LoadedNote) が使うフック

// フェンスを持つかの粗い判定。**行頭に縛らない** — 引用 (`> `) や箇条書きの
// 中のフェンスも描かれるので、縛ると図が出ない。取りすぎ (本文中の文字列に
// 当たる) は 1 回余分に引くだけで済む
const NEEDS_RENDER = new RegExp(`(?:\`{3,}|~{3,})\\s*(?:${MATRIX_LANG}|${HEALTH_LANG})\\b`);

// モジュールが足すタブ (予定など。docs/126 §1-4)。URL の ?tab= と ?date= は
// 開いたときの値を控える — 3 ペインでは URL が /item を離れてもノートが残るので、
// 後から読むと「予定」タブが消えてしまう
export function useNoteTabs(itemId: string, item: Item | null) {
  const searchParams = useSearchParams();
  const [opened] = useState(() => ({ tab: searchParams.get("tab"), date: searchParams.get("date") }));
  const { mode: paneMode } = usePaneMode();
  const query = searchParams.get("q") ?? "";
  const extraTabs = useMemo(
    () =>
      noteTabsFor({
        itemId,
        item,
        tab: opened.tab,
        date: opened.date,
        query,
        fullscreen: notePaneLayout(paneMode) === "fullscreen",
      }),
    [itemId, item, opened, query, paneMode],
  );
  return { extraTabs, openedTab: opened.tab };
}

// 本文へ渡す操作は id ごとに 1 度だけ作る。描画のたびに bind し直すと、
// チェックボックスが押すたびに新しい関数を受け取る (描き直しの種になる)
export function useNoteActions(itemId: string) {
  const onToggleTask = useMemo(() => toggleMemoTaskAction.bind(null, itemId), [itemId]);
  const onRecordHealth = useMemo(() => recordHealthAction.bind(null, itemId), [itemId]);
  return { onToggleTask, onRecordHealth };
}

// 表・健康のフェンスを持つノートだけ集計を引く。持たないノートは
// オフラインの印の吹き出しに出す添付量だけ (印を出すときだけ)
export function useNoteRender(itemId: string, memo: string, showsPin: boolean) {
  const needsFullRender = NEEDS_RENDER.test(memo);
  const render = renderCache.useEntry(
    needsFullRender ? { itemId, full: true } : showsPin ? { itemId, full: false } : null,
  )?.value;
  // 表・グラフを持つノートだけ、集計が届くまで本文を待たせる。持たない
  // ノートで待つと、使わない集計のために本文が遅れる
  const waitsForRender = needsFullRender && render === undefined;
  return { render, waitsForRender };
}
