"use client";

import { formatSpec, type FormatAction } from "@/components/editor/markdownFormat";
import { errorText } from "@/lib/errorMessage";
import type { EditorRef, SetEditorError } from "./types";

export interface EditorCommands {
  applyFormat: (action: FormatAction) => void;
  addPage: () => Promise<void>;
}

// ツールバーから本文を直す操作のうち、状態を持たないもの (書式・ページ)
export function useEditorCommands({
  editorRef,
  setError,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
}): EditorCommands {
  // 書式メニューで選んだ記法を選択範囲へ掛ける (docs/70 §6)。
  // 何を変えるかは markdownFormat が決め、ここは反映と後始末だけ。
  // **focus を戻す**のが要点 — メニューのボタンを押した時点でエディタは
  // フォーカスを失っており、戻さないと続けて打てない (選択も見えなくなる)
  const applyFormat = (action: FormatAction) => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    view.dispatch(formatSpec(view.state, action));
    view.focus();
  };

  // ＋ で新しいページを足す (docs/74-ページ計画.md §5)。
  //
  // **区切り行を 1 つ挿すだけ**。本文は 1 枚のままなので、undo 履歴も
  // ライブプレビューもツールバーも今までどおり動く (ページごとに value を
  // 差し替える作りにしない理由は計画 §5)。
  //
  // notePages は remark を引き込むので、押すまで読み込まない (お絵かき・
  // スキャナと同じ流儀)。本文は **await の後に**読み直す — 読み込みを待つ
  // 間に打鍵が続いても、位置が古い本文のままにならないように
  const addPage = async () => {
    try {
      const { newPageInsertion } = await import("@/components/notePages");
      const view = editorRef.current?.view;
      if (!view) {
        return;
      }
      const { from, to, insert, cursor } = newPageInsertion(
        view.state.doc.toString(),
        view.state.selection.main.head,
      );
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: cursor },
        scrollIntoView: true,
      });
      view.focus();
    } catch (e) {
      // **黙って諦めない。** chunk の取得は電波が細いときに落ちるし、再デプロイ
      // で古い hash の chunk が消えた画面を開いたままでも落ちる。放っておくと
      // 「押したのに区切りが入らない」だけになり (コンソールの unhandled
      // rejection しか残らない)、この画面の他の失敗と違って手掛かりが無い。
      // 生のメッセージは英語で判じ物なので、まず日本語で言って括弧に添える
      setError(
        `ページを追加できませんでした。通信を確かめ、画面を再読み込みしてから試して下さい (${
          errorText(e)
        })`,
      );
    }
  };

  return { applyFormat, addPage };
}
