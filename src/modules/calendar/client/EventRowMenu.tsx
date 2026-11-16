"use client";

import { useRef, useState } from "react";
import { EditIcon, TrashIcon } from "@/components/icons";
import { RowActionMenu } from "@/components/item/row-actions/RowActionMenu";
import { anchorOriginOf, type RowAction } from "@/components/item/row-actions/RowActions";

// 日の一覧の ︙ を押したときのメニュー (docs/126 §1-38)。検索結果の行の ⋯ と同じ
// RowActionMenu を使う (body へ出す・外を押す/Esc で閉じる・↑ ↓ で項目を渡る・
// 閉じたら ︙ へ焦点を返す、が揃っている)。削除は赤で末尾に並ぶ
export function EventRowMenu({
  title,
  anchor,
  onEdit,
  onDelete,
  onClose,
}: {
  title: string;
  // 押した ︙。そのそばに出し、閉じたら焦点を返す
  anchor: HTMLElement;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const anchorRef = useRef<HTMLElement | null>(anchor);
  // 置き場所は開いたときの ︙ の位置で 1 度だけ決める (描くたびに作ると測り直しが回る)
  const [origin] = useState(() => anchorOriginOf(anchor));
  const actions: RowAction[] = [
    { key: "edit", label: "編集", icon: <EditIcon />, onSelect: onEdit },
    { key: "delete", label: "削除", icon: <TrashIcon />, danger: true, onSelect: onDelete },
  ];
  return (
    <RowActionMenu
      label={`${title} の操作`}
      actions={actions}
      origin={origin}
      anchorRef={anchorRef}
      onClose={onClose}
    />
  );
}
