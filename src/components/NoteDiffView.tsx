"use client";

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";

interface NoteDiffViewProps {
  oldText: string;
  newText: string;
}

// 版と版の本文差分 (docs/57-ノートgit履歴計画.md §5)。
//
// @codemirror/merge の unified 表示を読み取り専用で使う。エディタ
// (MemoEditorInner) と同じ CodeMirror 6 系なので依存が素直で、将来の
// 3-way マージ (衝突解決) も同じ部品で作れる。差分の計算はクライアント側 —
// サーバは 2 版の本文を渡すだけにして、diff 形式の受け渡しを発明しない。
export function NoteDiffView({ oldText, newText }: NoteDiffViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: newText,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          // 本文は日本語の長文なので折り返す (エディタと同じ見え方)
          EditorView.lineWrapping,
          unifiedMergeView({
            original: oldText,
            // 読み取り専用なので変更の取り込み/巻き戻しボタンは出さない
            mergeControls: false,
            gutter: true,
            // 行内の小さな書き換えは行の削除+追加ではなく行内差分で見せる
            allowInlineDiffs: true,
            // 変わっていない行は畳む (長いノートでも差分だけが目に入る)
            collapseUnchanged: { margin: 3, minSize: 6 },
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [oldText, newText]);

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded border border-gray-300 bg-white text-sm"
    />
  );
}
