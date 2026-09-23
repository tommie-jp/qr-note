"use client";

import type { ViewUpdate } from "@codemirror/view";
import { useCallback, useState } from "react";
import { commitSpec } from "@/lib/editor/commitSpec";
import { fenceAtCursor, type FenceAtCursor } from "@/lib/editor/fenceAtCursor";
import { isGuiFenceLang } from "@/lib/markdown/fenceLanguages";
import type { EditorRef, SetEditorError } from "./types";

// 開いている図の編集。開いたときの本文 (全文) と、掴むフェンスの本文 1 行目
export interface OpenFenceGui {
  text: string;
  fenceLine: number;
}

export interface EditorFenceGui {
  // null なら閉じている
  fenceGui: OpenFenceGui | null;
  // カーソルが実体配線図のフェンスの中にあるか (下部バーの「図を編集」)
  canOpen: boolean;
  openFenceGui: () => void;
  closeFenceGui: (next: string) => void;
  // CodeMirror の onUpdate から呼ぶ (参照は変わらない)
  trackFenceGui: (update: ViewUpdate) => void;
}

// 閉じたときに本文が開いたときと違っていた (外から差し替わった)。
// 位置で当てると別の所を書き換えるので当てない
const STALE_MESSAGE =
  "図を開いている間に本文が変わったので、図の編集を反映できませんでした。もう一度開いて直してください";

// 押せるか (canOpen) と、押したときに開くか (openFenceGui) は同じ判定を使う。
// ここでまとめておかないと、判定を変えたときに片方だけ直し忘れる
function isOpenableFence(hit: FenceAtCursor | null): hit is FenceAtCursor {
  return hit !== null && isGuiFenceLang(hit.lang);
}

// 図を掴んで動かす殻 (docs/99-フェンスGUI編集計画.md)。秘密のフック
// (useEditorSecret) と同じ骨 — カーソルで押せるかが変わり、閉じたときに
// 1 回だけ本文へ当てる
export function useFenceGui({
  editorRef,
  setError,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
}): EditorFenceGui {
  const [fenceGui, setFenceGui] = useState<OpenFenceGui | null>(null);
  const [canOpen, setCanOpen] = useState(false);

  const openFenceGui = () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const hit = fenceAtCursor(view.state);
    if (!isOpenableFence(hit)) {
      return;
    }
    setFenceGui({ text: view.state.doc.toString(), fenceLine: hit.bodyLine });
  };

  // 殻が書き換えた全文を**差分 1 か所**としてエディタへ当てる。
  // 開く前との突き合わせは commitSpec が持つ
  const closeFenceGui = (next: string) => {
    const opened = fenceGui;
    setFenceGui(null);
    const view = editorRef.current?.view;
    if (!view || opened === null) {
      return;
    }
    const result = commitSpec(opened.text, next, view.state);
    if (result.kind === "stale") {
      setError(STALE_MESSAGE);
      return;
    }
    if (result.kind === "change") {
      view.dispatch(result.spec);
    }
    view.focus();
  };

  // **本文かカーソルが動いたときだけ**数える (秘密のラベルと同じ理由)。
  // 変わったときだけ setState して再レンダリングを止める
  const trackFenceGui = useCallback((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) {
      return;
    }
    const next = isOpenableFence(fenceAtCursor(update.state));
    setCanOpen((prev) => (prev === next ? prev : next));
  }, []);

  return { fenceGui, canOpen, openFenceGui, closeFenceGui, trackFenceGui };
}
