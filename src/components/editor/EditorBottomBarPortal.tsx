"use client";

import { createPortal } from "react-dom";
import { EditToolbar, type EditToolbarEditor } from "@/components/EditToolbar";
import { NoteSearchBar } from "./NoteSearchBar";
import type { NoteFind } from "./hooks/useNoteFind";

interface EditorBottomBarPortalProps {
  // 下部バーの差し込み口。出来るまで null (表向きのタブでない間も null)
  hostEl: HTMLElement | null;
  find: Pick<NoteFind, "findOpen" | "barProps">;
  toolbar: EditToolbarEditor;
}

// 操作ボタンを下部バーの差し込み口へ portal する (docs/93-リファクタリング計画.md §5-1)。
//
// portal は React ツリーの親子を保つので、更新ボタンの useFormStatus は囲みの
// form を拾い、各ハンドラはエディタの state/ref を触れる。
// **検索中はツールバーの代わりに検索バーを出す** (docs/76 §2) —
// 並べると帯が 2 段になり、狭い画面で本文が潰れる
export function EditorBottomBarPortal({
  hostEl,
  find,
  toolbar,
}: EditorBottomBarPortalProps) {
  // 2 つを別の枠に置く (1 つの枠で出し分けない)。開閉のたびに片方を外して
  // もう片方を新しく差す形を、分ける前の MemoEditorInner と揃えておく
  return (
    <>
      {hostEl &&
        find.findOpen &&
        createPortal(<NoteSearchBar {...find.barProps} />, hostEl)}
      {hostEl &&
        !find.findOpen &&
        createPortal(<EditToolbar editor={toolbar} />, hostEl)}
    </>
  );
}
