"use client";

import type { Compartment } from "@codemirror/state";
import { useState } from "react";
import { livePreviewContent } from "@/components/editor/livePreview";
import { loadLivePreviewPref, saveLivePreviewPref } from "@/lib/livePreviewPref";
import { browserStorage } from "@/lib/prefs/storagePref";
import type { EditorRef } from "./types";

export interface LivePreview {
  livePreview: boolean;
  toggleLivePreview: () => void;
  // 検索中だけ畳む / 戻す。設定 (localStorage) は書き換えない
  setLivePreviewSuspended: (suspended: boolean) => void;
}

// ライブプレビュー (docs/70-編集ライブプレビュー計画.md)。記法を隠して
// 装飾済みに見せる表示で、**本文は書き換えない**。OFF は従来の編集表示。
//
// 差し込み口 (Compartment) は拡張一式と一緒に useEditorExtensions が作る。
// 最初の中身もそこで決まる — ここが持つのはボタンの見た目と切り替えだけ
export function useLivePreview({
  editorRef,
  compartment,
}: {
  editorRef: EditorRef;
  compartment: Compartment;
}): LivePreview {
  // この部品は ssr: false で読み込まれる (MemoEditor.tsx) ので、初期値を
  // localStorage から同期に読んでも hydration はずれない
  // (触れない環境では既定で動く。例外の扱いは prefs/storagePref.ts)
  const [livePreview, setLivePreview] = useState(() =>
    loadLivePreviewPref(browserStorage()),
  );

  // ON/OFF。Compartment の中身だけを入れ替えるので、拡張一式の組み直しも
  // 本文への書き込みも起きない (履歴に 1 手も積まれない)
  const toggleLivePreview = () => {
    const next = !livePreview;
    setLivePreview(next);
    saveLivePreviewPref(browserStorage(), next);
    const view = editorRef.current?.view;
    if (view) {
      view.dispatch({
        effects: compartment.reconfigure(livePreviewContent(next)),
      });
    }
  };

  // ライブプレビューを検索中だけ畳む (docs/76-ノート内検索計画.md §4)。
  // 記法を隠した範囲は DOM に無く、そこに当たった一致はハイライトが出ない
  // まま「何も無い所」へ飛ぶ。
  // **設定 (localStorage) は書き換えない** — 閉じれば元の見え方に戻る
  const setLivePreviewSuspended = (suspended: boolean) => {
    const view = editorRef.current?.view;
    if (!view || !livePreview) {
      return; // もともと OFF なら触るものがない
    }
    view.dispatch({
      effects: compartment.reconfigure(livePreviewContent(!suspended)),
    });
  };

  return { livePreview, toggleLivePreview, setLivePreviewSuspended };
}
