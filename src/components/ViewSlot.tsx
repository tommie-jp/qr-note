"use client";

import type { ReactNode } from "react";
import { BarSlot } from "@/components/BarSlot";
import {
  GridViewIcon,
  ImageViewIcon,
  ListViewIcon,
} from "@/components/MenuIcons";
import { cycleOf } from "@/lib/cycle";
import { VIEW_MODES, VIEW_MODE_COOKIE, type ViewMode } from "@/lib/viewMode";

// 表示は 小→大→画像 の 3 値を 1 スロットで循環するトグル (docs/32 §3)。
// セグメントにはしない。ラベルには**現在の値**を出す — ViewModeToggle が
// セグメントを選んだ理由 (いま何が選ばれているか常に見える) は、現在値を
// ラベルに出すことで保たれる (docs/31 §3-4)
const VIEW_LABEL: Record<ViewMode, string> = {
  compact: "小",
  card: "大",
  image: "画像",
};

const VIEW_ICON: Record<ViewMode, ReactNode> = {
  compact: <ListViewIcon />,
  card: <GridViewIcon />,
  image: <ImageViewIcon />,
};

// 循環の順とメニューの上下は同じ並び (VIEW_MODES) から作る。短いタップで
// 辿る順とメニューの並びが食い違うと、押す前に何が起きるか読めなくなる
const NEXT_VIEW_OF = cycleOf(VIEW_MODES);

const VIEW_COLOR = "text-emerald-600";

interface ViewSlotProps {
  view: ViewMode;
  // cookie を書くサーバーアクション (prop で受ける理由は BarSlot)
  action: (formData: FormData) => void | Promise<void>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

// 下部バーの「表示」スロット。**検索一覧とゴミ箱で同じ物を出す**
// (docs/67-ゴミ箱表示形式計画.md §4) ので、選択肢も色も配線もここに置く。
// 表示モードの cookie は path='/' の 1 つきりで、画面をまたいで共有される —
// 「どう見たいか」は端末ごとの好みで、一覧の種類ごとに分ける物ではない。
export function ViewSlot({
  view,
  action,
  open,
  onOpen,
  onClose,
}: ViewSlotProps) {
  return (
    <BarSlot
      action={action}
      cookieName={VIEW_MODE_COOKIE}
      current={view}
      nextOf={NEXT_VIEW_OF}
      labelOf={VIEW_LABEL}
      iconOf={VIEW_ICON}
      color={VIEW_COLOR}
      describe={(mode) =>
        `表示: ${VIEW_LABEL[mode]} (押すと${VIEW_LABEL[NEXT_VIEW_OF[mode]]}に切替、長押しで一覧)`
      }
      menuLabel="表示"
      items={VIEW_MODES.map((mode) => ({
        key: mode,
        value: mode,
        label: VIEW_LABEL[mode],
        icon: VIEW_ICON[mode],
        checked: mode === view,
      }))}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
}
