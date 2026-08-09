"use client";

import type { ReactNode } from "react";
import { COMPACT_ICON_BUTTON_CLASS } from "./ui";

// 検索結果の 1 行に対して行える操作 (docs/66-行アクション計画.md §3)。
//
// **一覧を 1 か所で組み、PC のボタン列とスマホのメニューを同じ配列から作る。**
// 増える見込みのある物 (ピン留め・複製など) を 2 か所に書き分けると、必ず
// 片方だけ足りない状態になる。組む場所は SwipeToTrashRow — 送信中/失敗の
// 状態を持てるのがあそこだけなので、実行する手と同じ所に置く。
export interface RowAction {
  key: string;
  // 「ゴミ箱へ移動」。ボタンでは aria-label、メニューでは表示される文字
  label: string;
  icon: ReactNode;
  // 取り返しの付きにくい操作。赤で描く
  danger?: boolean;
  onSelect: () => void;
}

// 押下がこのボタン列の上で起きたかを見る印 (closest に渡すセレクタ)。
// 行の pointer ハンドラ (スワイプ・長押し) は、ここへの押下を掴まず素通しする
export const ROW_ACTION_SELECTOR = "[data-row-action]";

interface RowActionButtonsProps {
  itemNo: string;
  actions: RowAction[];
  view: "compact" | "card";
}

// PC でホバーしたときだけ現れる、行の右端のアイコンボタン列。
//
// 1 件をゴミ箱へ入れる道はこれまでスワイプ (指) と選択モード (3 手) しか
// なく、**マウスに近道が無かった** (docs/66 §1)。
//
// 出し入れは opacity と pointer-events で行う:
//
//   - hidden にしない … display:none の要素はフォーカスを受けられず、
//     Tab で辿り着けない。行の高さも出し入れのたびに変わる。
//   - pointer-events-none が要る … opacity だけだと、ホバーの無い環境で
//     **見えないボタンがタップを吸う**。
//   - group-focus-within でも出す … ホバーでしか出ないボタンは、
//     キーボードの利用者にとって存在しないのと同じ。
//
// Tailwind v4 の hover 系は @media (hover: hover) に包まれるので、スマホで
// 触れた指にボタンが貼り付くことはない (あちらは長押しのメニューが受ける)。
export function RowActionButtons({
  itemNo,
  actions,
  view,
}: RowActionButtonsProps) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <div
      data-row-action=""
      // z-10 … タイトルの当たり判定 (::after) より前に出す。膜の下に居ると
      // ボタンを押してもノートが開く (タグを relative z-10 にするのと同じ)
      className={`pointer-events-none absolute z-10 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${
        view === "card" ? "top-2 right-2" : "inset-y-0 right-2 items-center"
      }`}
    >
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onSelect}
          // 「#12 をゴミ箱へ移動」。読み上げでは行の見出しが離れて聞こえる
          // ので、どのノートに対する操作かを毎回名乗る
          aria-label={`#${itemNo} を${action.label}`}
          title={action.label}
          className={`${COMPACT_ICON_BUTTON_CLASS} ${
            action.danger ? "hover:bg-red-50" : ""
          }`}
        >
          {/* 色は中の span で与える。ボタン側のクラス (COMPACT_ICON_BUTTON_CLASS)
              は text-gray-700 を含んでおり、同じ要素に text-red-700 を足すと
              どちらが勝つかが生成 CSS の並び順任せになる (ui.ts の
              SLOT_MENU_ITEM_SKIN と同じ事情)。要素を分ければ継承で必ず勝つ */}
          <span className={action.danger ? "text-red-700" : ""}>
            {action.icon}
          </span>
        </button>
      ))}
    </div>
  );
}
