"use client";

import { useState } from "react";
import type { TagUndoState } from "../search/BulkTagToolbar";
import { tagUndoMessage, type TagChangeSet } from "@/lib/markdown/tags/bulk";
import { useSelectMode } from "../search/SelectModeProvider";

// 検索結果リスト (ItemList) の選択モード: 選んだ番号・一括タグの取り消し

// bulkTagAction をそのまま import すると db.ts (DATABASE_URL 必須) まで巻き込み
// テストが動かないため、サーバーアクションは page.tsx から prop で受け取る。
export type BulkTagAction = (formData: FormData) => void | Promise<void>;
// 一括タグの「追加」「外す」。ノートごとに実際に変わったタグを返す
export type BulkTagSubmit = (formData: FormData) => Promise<TagChangeSet>;
// 直前の一括タグを取り消す (追加なら外す・外したなら元の位置に戻す)
export type UndoTagAction = (set: TagChangeSet) => Promise<void>;

interface TagUndo {
  set: TagChangeSet;
  status: TagUndoState["status"];
}

// 選択モードの入り切りは下部バーが持つ (docs/31-下部操作バー計画.md §5-2)。
// 選んだ番号の Set はここに残す — バーは「何件選ばれたか」を知る必要がなく、
// 持ち上げても使い道がない
export function useItemListSelection(action: BulkTagSubmit, undoTagAction: UndoTagAction) {
  const { selectMode, exit } = useSelectMode();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // 直前の一括タグの取り消し (BulkTagToolbar の「元に戻す」)。取り消せるのは
  // 直前の 1 回だけ — 次の操作を送るか、選択モードを抜けたら捨てる
  const [tagUndo, setTagUndo] = useState<TagUndo | null>(null);

  // 選択モードを抜けたら選択を捨てる。バーから抜けることもあるので、
  // 抜ける操作それぞれに後始末を配らず、モードの変化 1 か所で受ける
  const [wasSelectMode, setWasSelectMode] = useState(selectMode);
  if (selectMode !== wasSelectMode) {
    setWasSelectMode(selectMode);
    if (!selectMode) {
      setSelected(new Set());
      setTagUndo(null);
    }
  }

  const toggle = (itemId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });

  return {
    selectMode,
    exit,
    selected,
    setSelected,
    toggle,
    ...tagUndoHandlers(tagUndo, setTagUndo, action, undoTagAction),
  };
}

function tagUndoHandlers(
  tagUndo: TagUndo | null,
  setTagUndo: (next: TagUndo | null) => void,
  action: BulkTagSubmit,
  undoTagAction: UndoTagAction,
) {
  const submitBulkTags = async (formData: FormData) => {
    setTagUndo(null);
    const set = await action(formData);
    if (set.changes.length > 0) {
      setTagUndo({ set, status: "ready" });
    }
  };

  const undoTags = async () => {
    if (tagUndo === null || tagUndo.status === "busy" || tagUndo.status === "done") {
      return;
    }
    const { set } = tagUndo;
    setTagUndo({ set, status: "busy" });
    try {
      await undoTagAction(set);
      setTagUndo({ set, status: "done" });
    } catch (error) {
      console.error("一括タグを取り消せませんでした", error);
      setTagUndo({ set, status: "failed" });
    }
  };

  // ゴミ箱・オフラインの送信も「次の操作」なので、取り消しの帯を先に畳む
  const clearingTagUndo =
    (send: BulkTagAction): BulkTagAction =>
    (formData) => {
      setTagUndo(null);
      return send(formData);
    };

  // ツールバーに渡す取り消しの帯。取り消せる物が無ければ出さない
  const tagUndoState: TagUndoState | undefined =
    tagUndo === null
      ? undefined
      : {
          message: tagUndoMessage(tagUndo.set),
          status: tagUndo.status,
          onUndo: undoTags,
        };

  return { submitBulkTags, clearingTagUndo, tagUndoState };
}
