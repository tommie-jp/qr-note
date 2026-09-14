"use client";

import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { useCallback, useState } from "react";
import type { EditorRef } from "./types";

export interface EditorHistory {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  // CodeMirror の onUpdate から呼ぶ (参照は変わらない)
  trackHistory: (update: ViewUpdate) => void;
}

// undo / redo ボタン (docs/11-アプリ的UIUX計画.md §2-4)。
// 履歴自体は basicSetup が既定で持っている (Ctrl+Z も従来どおり効く)
export function useEditorHistory({
  editorRef,
}: {
  editorRef: EditorRef;
}): EditorHistory {
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  // 履歴の深さが変わったときだけボタンの活殺を更新する。
  // onUpdate はカーソル移動でも呼ばれるので、同じ値なら前の state を
  // 返して再レンダリングを止める。
  // **参照を固定する** — CodeMirror は onUpdate の参照が変わると拡張一式を
  // 組み直す (useEditorExtensions の BASIC_SETUP のコメント参照)
  const trackHistory = useCallback((update: ViewUpdate) => {
    const next = {
      canUndo: undoDepth(update.state) > 0,
      canRedo: redoDepth(update.state) > 0,
    };
    setHistory((prev) =>
      prev.canUndo === next.canUndo && prev.canRedo === next.canRedo
        ? prev
        : next,
    );
  }, []);

  // ボタンから呼ぶ。モバイルには Ctrl+Z がないため
  const runHistoryCommand = (command: (view: EditorView) => boolean) => {
    const view = editorRef.current?.view;
    if (view) {
      command(view);
      view.focus();
    }
  };

  return {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: () => runHistoryCommand(undo),
    redo: () => runHistoryCommand(redo),
    trackHistory,
  };
}
