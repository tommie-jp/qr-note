"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  placeRowActionMenu,
  type MenuPoint,
  type MenuPosition,
} from "@/lib/rowActionMenu";
import type { RowAction } from "./RowActions";
import { ROW_MENU_ITEM_DANGER_CLASS, SLOT_MENU_ITEM_CLASS } from "./ui";

interface RowActionMenuProps {
  // 読み上げ用。「#12 の操作」
  label: string;
  actions: RowAction[];
  // 長押しした指の位置 (clientX/Y)
  at: MenuPoint;
  onClose: () => void;
}

// 検索結果の行を長押ししたときに、指の近くへ出す操作メニュー
// (docs/66-行アクション計画.md §5-3)。
//
// 下部バーの SlotMenu とは別物にしてある。あちらはスロットの真上へ
// absolute で出す前提で、行にはそのまま使えない:
//
//   - 行の li は overflow-hidden … スワイプで隠した削除ボタンを切るために
//     必要で、中に absolute で出すとメニューごと切られる。
//   - 行の前面 div は transform を持つ … スワイプで translateX するので、
//     **fixed の包含ブロックになる**。中に置いた fixed は画面ではなく
//     その行を基準にしてしまう。
//
// そこで body へ portal し、fixed で画面座標に置く。portal した先は
// transform も overflow も持たないので、どちらの罠にも掛からない。
//
// 外側の押下で閉じるのは SlotMenu と同じ手 (document の pointerdown を
// capture で拾う)。click では iOS Safari が取りこぼす。
export function RowActionMenu({
  label,
  actions,
  at,
  onClose,
}: RowActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  // 呼ぶ側が毎描画で新しい関数を渡しても、購読をやり直さないようにする
  const close = useEffectEvent(() => onClose());

  // 置き場所は実寸が要る (項目数でも文字サイズ設定でも高さが変わる) ので、
  // 一度描いてから測る。**useLayoutEffect で測る** — useEffect だと
  // 描画されてから位置が決まるので、左上に一瞬出てから飛ぶのが見える
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!box) {
      return;
    }
    setPosition(
      placeRowActionMenu(
        at,
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [at]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    // 画面が動いたら閉じる。fixed で画面座標に置いてあるので、スクロールや
    // 回転で行だけが動くと、メニューが無関係な場所を指したまま残る
    const onScrollOrResize = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
      // z-40 … 下部バー (z-10) より前、全画面のモーダル (z-50) より後ろ。
      // 測る前は見せない (visibility) — 位置が決まる前の 1 フレームが
      // 左上に見えてしまうため。display ではなく visibility なのは、
      // display:none だと寸法が測れないから
      className={`fixed z-40 flex w-max max-w-[80vw] flex-col overflow-hidden rounded-lg border border-gray-300 bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] motion-safe:animate-sheet-up ${
        position ? "" : "invisible"
      }`}
    >
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          role="menuitem"
          onClick={() => {
            action.onSelect();
            onClose();
          }}
          className={
            action.danger ? ROW_MENU_ITEM_DANGER_CLASS : SLOT_MENU_ITEM_CLASS
          }
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
