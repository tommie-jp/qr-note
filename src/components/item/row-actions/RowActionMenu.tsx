"use client";

import {
  Fragment,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  placeRowActionMenuFrom,
  type MenuOrigin,
  type MenuPosition,
} from "@/lib/gesture/rowActionMenu";
import type { RowAction } from "./RowActions";
import { ROW_MENU_ITEM_CLASS, ROW_MENU_ITEM_DANGER_CLASS } from "../../ui";
import { orderMenuActions, nextMenuIndex } from "./rowMenuOrder";

interface RowActionMenuProps {
  // 読み上げ用。「#12 の操作」
  label: string;
  actions: RowAction[];
  // どこから開いたか。長押しは指の点、⋮ はボタンの矩形 (docs/107 §4)
  origin: MenuOrigin;
  // ⋮ ボタン。ここへの押下は「外側」に数えない — 数えると押下で閉じた直後の
  // click がまた開き、⋮ でメニューを閉じられなくなる。⋮ から開いたときは
  // 閉じたあとフォーカスをここへ返す。ref のまま受けるのは、描画中に
  // current を読まないため (読むのはイベントの中だけ)
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

// 検索結果の行の操作メニュー (docs/66-行アクション計画.md §5-3、
// docs/107-行メニュー計画.md)。⋮ ボタンからも長押しからも同じこれを開く。
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
  origin,
  anchorRef,
  onClose,
}: RowActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const ordered = orderMenuActions(actions);
  // ⋮ から開いたか。フォーカスをメニューへ移し、閉じたら ⋮ へ返すのは
  // こちらだけ。長押しは指の操作で、キーボードで項目を渡る人が居ない。
  // 移すと閉じたときの返し先が無い (⋮ へ返すと、フォーカスの印で行の
  // 近道まで出てしまう)
  const isFromButton = origin.kind === "anchor";
  // 呼ぶ側が毎描画で新しい関数を渡しても、購読をやり直さないようにする
  const close = useEffectEvent(() => onClose());

  // キーボードで閉じた・選んだときは、開いた ⋮ へフォーカスを返す。
  // 返さないとフォーカスが消えたメニューと一緒に body へ落ち、Tab が
  // ページの先頭からやり直しになる。外側を押して閉じたときは返さない
  // (押した先が次のフォーカスを持つ)
  const closeAndRestore = () => {
    if (isFromButton) {
      anchorRef.current?.focus({ preventScroll: true });
    }
    onClose();
  };
  const closeAndRestoreEvent = useEffectEvent(() => closeAndRestore());

  // 置き場所は実寸が要る (項目数でも文字サイズ設定でも高さが変わる) ので、
  // 一度描いてから測る。**useLayoutEffect で測る** — useEffect だと
  // 描画されてから位置が決まるので、左上に一瞬出てから飛ぶのが見える
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!box) {
      return;
    }
    setPosition(
      placeRowActionMenuFrom(
        origin,
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [origin]);

  // ⋮ から開いたら、置けたところで先頭の項目へフォーカスを移す
  // (WAI-ARIA のメニューボタンの作法)。
  // **置く前は移せない** — 測る間は visibility:hidden で、隠れた要素は
  // フォーカスを受けない。preventScroll … 移したはずみで画面が動くと、
  // 下のスクロール監視がメニューを閉じてしまう
  const isPlaced = position !== null;
  useEffect(() => {
    if (!isPlaced || !isFromButton) {
      return;
    }
    menuItems(menuRef.current)[0]?.focus({ preventScroll: true });
  }, [isPlaced, isFromButton]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) ||
          anchorRef.current?.contains(target))
      ) {
        return;
      }
      close();
    };
    // Esc は document で拾う。メニューの onKeyDown だけで見ると、メニューの
    // 余白を押してフォーカスが body へ落ちた後などに Esc が効かなくなる
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAndRestoreEvent();
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
  }, [anchorRef]);

  // ↑↓ で項目を渡り、Tab で閉じる (Esc は上の document で拾う)。
  // preventDefault … ↑↓ の既定は画面のスクロールで、スクロールで閉じてしまう
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      // Tab はメニューを閉じて**次の部品へ進める** (メニューの作法)。
      // 既定の動きは止めず、先に ⋮ へフォーカスを返しておく — すると
      // ブラウザの Tab は ⋮ の次 (Shift なら前) へ進む。止めて ⋮ に
      // 留めると、行ごとに Tab を 1 回余計に押すことになる
      closeAndRestore();
      return;
    }
    const items = menuItems(menuRef.current);
    const current = items.findIndex((item) => item === document.activeElement);
    const next = nextMenuIndex(event.key, current, items.length);
    if (next === null) {
      return;
    }
    event.preventDefault();
    items[next]?.focus({ preventScroll: true });
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
      // z-40 … 下部バー (z-10) より前、全画面のモーダル (z-50) より後ろ。
      // 測る前は見せない (visibility) — 位置が決まる前の 1 フレームが
      // 左上に見えてしまうため。display ではなく visibility なのは、
      // display:none だと寸法が測れないから
      className={`fixed z-40 flex w-max min-w-44 max-w-[80vw] flex-col overflow-hidden rounded-lg border border-gray-300 bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] motion-safe:animate-sheet-up ${
        position ? "" : "invisible"
      }`}
    >
      {ordered.map(({ action, separatorBefore }) => (
        <Fragment key={action.key}>
          {separatorBefore && (
            <div role="separator" className="my-1 border-t border-gray-200" />
          )}
          <button
            type="button"
            role="menuitem"
            // 項目は ↑↓ で渡る。Tab の巡回からは外す (Tab はメニューを閉じる)
            tabIndex={-1}
            onClick={() => {
              action.onSelect();
              closeAndRestore();
            }}
            className={
              action.danger ? ROW_MENU_ITEM_DANGER_CLASS : ROW_MENU_ITEM_CLASS
            }
          >
            {action.icon}
            {/* 名前は文字で出す (docs/107 §3)。メニュー自身が「#12 の操作」と
                名乗っているので、番号は重ねない */}
            <span>{action.label}</span>
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu
    ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    : [];
}
