"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode, Ref } from "react";
import type { MenuOrigin } from "@/lib/gesture/rowActionMenu";
import { MoreIcon } from "../../icons";
import { COMPACT_ICON_BUTTON_CLASS, ROW_MENU_TRIGGER_CLASS } from "../../ui";

// 検索結果の 1 行に対して行える操作 (docs/66-行アクション計画.md §3)。
//
// **一覧を 1 か所で組み、PC のボタン列と ⋮ / 長押しのメニューを同じ配列から作る。**
// 増える見込みのある物 (ピン留め・複製など) を 2 か所に書き分けると、必ず
// 片方だけ足りない状態になる。組む場所は SwipeToTrashRow — 送信中/失敗の
// 状態を持てるのがあそこだけなので、実行する手と同じ所に置く。
export interface RowAction {
  key: string;
  // 「ゴミ箱へ移動」。ボタンでは aria-label、メニューでは表示される文字
  label: string;
  icon: ReactNode;
  // 取り返しの付きにくい操作。赤で描き、メニューでは区切り線の下 (末尾) に置く
  danger?: boolean;
  // PC でホバーしたとき ⋮ の左に並べる近道にするか (docs/107-行メニュー計画.md §2)。
  // 付けるのはよく使う 1〜2 個だけ — 増やすとサムネを覆う帯が伸び、
  // 「⋮ を開けば全部ある」という形が崩れる。付けなくてもメニューには必ず出る
  quick?: boolean;
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

// PC でホバーしたときだけ現れる、⋮ の左のアイコンボタン列 (近道)。
// 並べるのは quick の付いた操作だけ (docs/107 §2)。
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
//   - キーボードのフォーカスが行に入ったときも出す … ホバーでしか出ない
//     ボタンは、キーボードの利用者にとって存在しないのと同じ。
//     **focus-within ではなく「行の中に :focus-visible があるか」で見る**
//     (docs/107 §2)。Android の Chrome はタップしたボタンにフォーカスを
//     置くので、focus-within だと ⋮ をタップしただけでスマホにも近道が
//     出てしまう。タップのフォーカスは focus-visible にならない。
//
// Tailwind v4 の hover 系は @media (hover: hover) に包まれるので、スマホで
// 触れた指にボタンが貼り付くことはない (あちらは ⋮ と長押しのメニューが受ける)。
export function RowActionButtons({
  itemNo,
  actions,
  view,
}: RowActionButtonsProps) {
  const quick = actions.filter((action) => action.quick);
  if (quick.length === 0) {
    return null;
  }
  return (
    <div
      data-row-action=""
      // z-10 … タイトルの当たり判定 (::after) より前に出す。膜の下に居ると
      // ボタンを押してもノートが開く (タグを relative z-10 にするのと同じ)
      className={`pointer-events-none absolute z-10 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 ${
        view === "card" ? "top-2 right-11" : "inset-y-0 right-11 items-center"
      }`}
    >
      {quick.map((action) => (
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

// ⋮ の置き場所。tile は画像モードのタイル (docs/107 §7)
export type RowMenuTriggerPlacement = "compact" | "card" | "tile";

// 置き場所ごとの寸法と位置。
//   tile … 画像の下のキャプション行 (#番号 タイトル) の右端。タイル (li) を
//     @container にしておき、top を 100cqw (= タイルの幅 = 正方形の画像の高さ)
//     にすると画像のすぐ下に揃う。画像の上に置かないのは、画像への操作ではなく
//     ノートへの操作だと読ませるため。高さは 24px、幅は他と同じく指で狙える
//     36px を取る。**キャプション行 (ImageMasonry) は ⋮ より高く取る** —
//     タグの無いタイルで ⋮ が li の下端からはみ出すと、押してフォーカスが
//     移った瞬間にブラウザが li (overflow-hidden) の中をスクロールして ⋮ を
//     見せようとし、そのスクロールでメニューが閉じる (E2E で実際に踏んだ)
const TRIGGER_PLACEMENT_CLASS: Record<RowMenuTriggerPlacement, string> = {
  compact: "inset-y-0 right-0 w-10 rounded",
  card: "top-1.5 right-1.5 size-9 rounded-full bg-white/85",
  tile: "top-[100cqw] right-0 h-6 w-9 rounded",
};

interface RowMenuTriggerProps {
  itemNo: string;
  view: RowMenuTriggerPlacement;
  isOpen: boolean;
  // 送信中。押しても何もしない
  disabled: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  ref: Ref<HTMLButtonElement>;
}

// ⋮ の矩形からメニューの起点を作る。
// shiftX … ⋮ が今ずれている量 (スワイプの引き出しの translateX)。開くと同時に
// 引き出しを畳むので、畳んだ後の位置を先に出す (SwipeToTrashRow)
export function anchorOriginOf(element: Element, shiftX = 0): MenuOrigin {
  const rect = element.getBoundingClientRect();
  return {
    kind: "anchor",
    rect: {
      left: rect.left - shiftX,
      top: rect.top,
      right: rect.right - shiftX,
      bottom: rect.bottom,
    },
  };
}

// 行の右端に常設する ⋮ ボタン (docs/107-行メニュー計画.md §2)。
//
// **長押しとホバーは「知っている人の近道」で、見える入口ではない。**
// スマホで行に操作があると知る手掛かりが無かったので、PC・スマホとも
// これを常に出し、全部の操作はここから辿れるようにする。
//
// 置き場所:
//   - 小・中表示 … 行の全高を当たり判定にする (inset-y-0)。行は 32px ほどで、
//     36px 角のボタンを中央に置くと上下が li の overflow-hidden に切られる。
//     全高にすれば指で狙う縦幅も行の高さぶん取れる。
//   - カード … 右上の 36px 角。サムネの角に重なることがあるので白い地を敷く。
//
// data-row-action … 押下をスワイプ・長押し・stretched link に渡さない印
// (useRowGestureArbiter)。ここを押して行が滑ったりノートが開いたりしない。
// z-10 … タイトルの当たり判定 (::after) より前に出す
export function RowMenuTrigger({
  itemNo,
  view,
  isOpen,
  disabled,
  onClick,
  ref,
}: RowMenuTriggerProps) {
  return (
    <button
      ref={ref}
      type="button"
      data-row-action=""
      // **disabled 属性ではなく aria-disabled で止める。** メニューで操作を
      // 選ぶとフォーカスはここへ返る (RowActionMenu) が、直後に送信中で
      // disabled にすると、フォーカスを持ったまま無効になって body へ落ちる。
      // Tab がページの先頭からやり直しになる
      onClick={(event) => {
        if (!disabled) onClick(event);
      }}
      aria-disabled={disabled || undefined}
      aria-label={`#${itemNo} の操作`}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      title="操作"
      className={`absolute z-10 aria-disabled:opacity-50 ${ROW_MENU_TRIGGER_CLASS} ${TRIGGER_PLACEMENT_CLASS[view]}`}
    >
      <MoreIcon />
    </button>
  );
}
