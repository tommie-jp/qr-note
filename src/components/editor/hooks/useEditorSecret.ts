"use client";

import type { ViewUpdate } from "@codemirror/view";
import { useCallback, useState } from "react";
import { insertText } from "@/lib/editor/cmDoc";
import {
  findSecretNotation,
  secretAtCursor,
  secretNotation,
  secretToolbarLabel,
} from "@/lib/secrets";
import type { EditorRef } from "./types";

// 開いているシークレットの入力ダイアログ。name が非 null なら既存の断片の
// 編集、null なら新規 (text は選択範囲)
export interface OpenSecret {
  name: string | null;
  text: string;
  label: string;
}

export interface EditorSecret {
  // null なら閉じている
  secret: OpenSecret | null;
  // ツールバーに出す文字。カーソルが記法の上なら「秘密を編集」に変わる
  // (docs/52 §1)。押した先の分岐は openSecret が持つので、これは見た目だけ
  secretLabel: string;
  openSecret: () => void;
  applySecret: (name: string, label: string) => void;
  closeSecret: () => void;
  // CodeMirror の onUpdate から呼ぶ (参照は変わらない)
  trackSecretLabel: (update: ViewUpdate) => void;
}

// シークレット (docs/51-部分暗号化計画.md §8, §12)。
//
// 平文がここから memo の state へ入ることはない。ダイアログは自分の中だけで
// 文字を持ち、封をしてから戻ってくる (記法だけが本文に入る)。
export function useEditorSecret({
  editorRef,
}: {
  editorRef: EditorRef;
}): EditorSecret {
  const [secret, setSecret] = useState<OpenSecret | null>(null);
  const [secretLabel, setSecretLabel] = useState("秘密");

  // カーソルがシークレット記法の上なら**その断片を開く** (編集)。そうでなければ
  // **選択範囲を引き継いで新規**にする — これが既存平文の移行導線そのもので、
  // 選んだ範囲がそのまま暗号化され、記法に置き換わる。
  const openSecret = () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const { from, to } = view.state.selection.main;
    const hit = secretAtCursor(view.state.doc.toString(), from);
    setSecret(
      hit
        ? { name: hit.name, text: "", label: hit.label }
        : { name: null, text: view.state.doc.sliceString(from, to), label: "" },
    );
  };

  // 封が済んだ断片を本文へ反映する。
  //
  // 新規は選択範囲を記法で置き換え、編集は**名前で引き直した位置**の記法を
  // 差し替える (ラベルを変えたときのため)。位置ではなく名前で引くので、
  // ダイアログを開いている間に本文が動いていても正しい場所に当たる。
  const applySecret = (name: string, label: string) => {
    const editing = secret !== null && secret.name !== null;
    setSecret(null);
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const notation = secretNotation(label, name);

    if (!editing) {
      insertText(view, notation);
      return;
    }

    const hit = findSecretNotation(view.state.doc.toString(), name);
    if (hit) {
      view.dispatch({ changes: { from: hit.from, to: hit.to, insert: notation } });
    } else {
      // 利用者が記法ごと消していた。中身は保存済みなので、参照を入れ直す
      insertText(view, notation);
    }
    view.focus();
  };

  // シークレットのボタン文字 (docs/52-シークレット編集導線計画.md §1)。
  // **本文かカーソルが動いたときだけ**数える。onUpdate は再描画や
  // フォーカスでも呼ばれるので、そのたびに全文を走査する必要はない。
  // 変わったときだけ setState して再レンダリングを止める
  const trackSecretLabel = useCallback((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) {
      return;
    }
    const label = secretToolbarLabel(
      update.state.doc.toString(),
      update.state.selection.main.from,
    );
    setSecretLabel((prev) => (prev === label ? prev : label));
  }, []);

  return {
    secret,
    secretLabel,
    openSecret,
    applySecret,
    closeSecret: () => setSecret(null),
    trackSecretLabel,
  };
}
