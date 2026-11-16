"use client";

import { editNoteHref } from "@/lib/client/clientNoteNav";
import { navigate } from "@/lib/client/navigation";
import { EditIcon } from "../../icons";
import type { RowAction } from "./RowActions";

// 行・タイルの ⋯ メニューの「編集」。押すとノートの編集画面へ移る。
// 行 (SwipeToTrashRow) では PC のホバーの近道にも並べる (quick)。タイルは
// 近道の列を持たないので、付けてもメニューに出るだけ
export function editRowAction(itemId: string): RowAction {
  return {
    key: "edit",
    label: "編集",
    icon: <EditIcon />,
    quick: true,
    onSelect: () => navigate(editNoteHref(itemId)),
  };
}
