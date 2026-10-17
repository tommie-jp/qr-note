"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useNoteChrome } from "@/components/notechrome/NoteChromeProvider";

// ホバーで開くまでの待ち。上端をかすめただけの通過で面がちらつかないように
export const HOVER_OPEN_DELAY_MS = 150;
// 離れてから閉じるまでの待ち。行から面へ移る途中や、面の縁を少し
// はみ出しただけで閉じないように
export const HOVER_CLOSE_DELAY_MS = 250;

// 行の高さ (48px = rowClassName の pt-1 + 釦の min-h-11)。**行自身に下限を
// 持たせる** — 釦が 1 つも無い間 (loading は「全画面で開く」が無く、⋯ は
// マウント後に portal で来る) も同じ高さでないと、浮かせたときに本文を
// 引き上げる量 (-mb-12) が行より大きくなり、本文の頭がスクロールで届かない
// 負の領域に入る (レビューで判明)。詰め物の高さ (h-12) も対
const ROW_MIN_HEIGHT_CLASS = "min-h-12";
const ROW_PULL_CLASS = "-mb-12";
const SPACER_HEIGHT_CLASS = "h-12";
// 詰め物の幅。札 (⋯ 44px + 全画面 44px + 余白) より少し広く取る
const SPACER_WIDTH_CLASS = "w-28";
// 右が文字の釦 (全画面で開く) のとき / 左の「閉じる」の札
const SPACER_WIDTH_WIDE_CLASS = "w-72";
const SPACER_WIDTH_START_CLASS = "w-28";
// 札の見た目 (左右共通)
const PILL_CLASS =
  "pointer-events-auto rounded-full bg-white/85 shadow-sm backdrop-blur";

interface NoteChromeBarProps {
  // 貼り付く位置 (器ごとに違う)。sticky と z はここで持つ
  className: string;
  // 地色。浮かせている間は外す (本文を透かせる)
  bgClass: string;
  // 行の中身の幅と余白 (器ごとに違う)
  rowClassName: string;
  // 左端 (閉じる)。置かないときも詰め物を置いて右端を右に保つ
  start?: ReactNode;
  // 右端 (全画面で開く)
  end?: ReactNode;
  // 畳む形のとき、行を本文の上に浮かせてよいか (docs/108 §3-6)。
  // 下部ペインは左端の「閉じる」が無く、行の左半分が空のまま 48px を
  // 占めるので浮かせる。全画面は「閉じる」が要るので浮かせない
  canFloat?: boolean;
}

// 浮いているか。畳む形 (重ねる面で操作を出す形) のときだけ — 積む形
// (常に出す・編集タブ) では見出し行の右端に札が重なるので、行に戻す。
// 器の外 (chrome === null) では畳めないので浮かせもしない
export function useNoteChromeFloating(canFloat: boolean): boolean {
  const chrome = useNoteChrome();
  return canFloat && chrome !== null && !chrome.inline;
}

// 本文の先頭に置く詰め物。浮いた札と同じ大きさを右上に float で確保し、
// 見出しや段落の最初の数行が札を避けて折り返すようにする (docs/108 §3-6)。
// 画像 (block) は避けずに札の下へ潜るが、札は半透明なので角が少し隠れるだけ。
// 浮いていないときは何も置かない
export function NoteChromeFloatSpacer({
  canFloat,
  withStart = false,
  wideEnd = false,
}: {
  canFloat: boolean;
  // 左にも札 (閉じる) があるとき、左にも詰め物を置く
  withStart?: boolean;
  // 右の札が文字の釦 (全画面で開く) で広いとき
  wideEnd?: boolean;
}) {
  const floating = useNoteChromeFloating(canFloat);
  if (!floating) {
    return null;
  }
  return (
    <>
      <div
        aria-hidden
        data-note-chrome-spacer=""
        className={`float-right ${SPACER_HEIGHT_CLASS} ${
          wideEnd ? SPACER_WIDTH_WIDE_CLASS : SPACER_WIDTH_CLASS
        }`}
      />
      {withStart && (
        <div
          aria-hidden
          className={`float-left ${SPACER_HEIGHT_CLASS} ${SPACER_WIDTH_START_CLASS}`}
        />
      )}
    </>
  );
}

export function NoteChromeBar({
  className,
  bgClass,
  rowClassName,
  start,
  end,
  canFloat = false,
}: NoteChromeBarProps) {
  const chrome = useNoteChrome();
  const rootRef = useRef<HTMLDivElement>(null);
  const floating = useNoteChromeFloating(canFloat);

  const scheduleHover = chrome?.scheduleHover;
  const setFocused = chrome?.setFocused;
  const dismiss = chrome?.dismiss;
  const revealed = chrome?.revealed ?? false;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !scheduleHover || !setFocused) {
      return;
    }
    // 指のタップでも pointerenter は飛んでくる。指の端末は ⋯ が受ける
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        scheduleHover(true, HOVER_OPEN_DELAY_MS);
      }
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        scheduleHover(false, HOVER_CLOSE_DELAY_MS);
      }
    };
    // タップやクリックのフォーカスは focus-visible にならない。Tab で
    // 入ったときだけ開く (docs/107 §2 と同じ判断)
    const onFocusIn = (event: FocusEvent) => {
      if (
        event.target instanceof Element &&
        event.target.matches(":focus-visible")
      ) {
        setFocused(true);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !root.contains(next)) {
        setFocused(false);
      }
    };
    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [scheduleHover, setFocused]);

  // 開いている間だけ、行の外を押したら・Esc を押したら閉じる。押下を capture で
  // 拾うのは、押された側 (本文のリンクなど) が伝播を止めても取りこぼさないため
  useEffect(() => {
    const root = rootRef.current;
    if (!revealed || !root || !dismiss) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) {
        dismiss();
      }
    };
    // Esc は行の中ではなく document で拾う。面の中のトグル (公開など) は
    // 押すと釦ごと差し替わり、フォーカスが body へ落ちる — 行の keydown では
    // 届かなくなる (E2E で判明)。開いている間だけなので、ほかの画面の Esc
    // (モーダル類) とは競らない。先に誰かが処理した Esc には乗らない
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        dismiss();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [revealed, dismiss]);

  // 浮かせる形 (docs/108 §3-6):
  //   行は sticky のまま、負の margin で本文を行の高さぶん引き上げる。行の
  //   高さは残るので、重ねる面の top-full はこれまでどおり札の下から出る。
  //   地色は外し、行の根は pointer-events-none にして空いた左側で本文の
  //   リンクや画像を塞がない。押せる物 (札・閉じる・重ねる面) だけ auto に
  //   戻す。根の pointerenter は子に入っても飛んでくるので、ホバーで開く
  //   仕掛けはそのまま効く (入口が行全体から札に縮むだけ)。
  //   **開いている間は行全体を auto に戻す** — 札から重ねる面へ、行の空いた
  //   所を横切ってマウスを運ぶと、根を離れた扱いになって面が閉じる
  //   (レビューで判明)。開いている間だけなら、行の下の本文を塞いでも困らない
  const rootClass = floating
    ? `${className} ${ROW_PULL_CLASS} ${revealed ? "" : "pointer-events-none"}`
    : `${className} ${bgClass}`;
  // 札。本文の上に乗っても読めるよう半透明の地に薄い影。overflow-hidden は
  // 使わない — 焦点の輪 (focus-visible の outline) まで切られる。中の釦は
  // それぞれ rounded-full で、押下色が札の縁からはみ出さない
  const endGroupClass = floating
    ? `flex items-center gap-1 ${PILL_CLASS}`
    : "flex items-center gap-1";
  return (
    <div
      ref={rootRef}
      data-note-chrome-bar=""
      data-note-chrome-floating={floating ? "" : undefined}
      className={`print:hidden ${rootClass}`}
    >
      <div
        className={`flex ${ROW_MIN_HEIGHT_CLASS} items-center justify-between gap-1 ${rowClassName}`}
      >
        {start ? (
          <div className={floating ? PILL_CLASS : undefined}>
            {start}
          </div>
        ) : (
          <span />
        )}
        <div className={endGroupClass}>
          <div
            ref={chrome?.setTriggerSlot}
            className="flex items-center gap-1 empty:hidden"
          />
          {end}
        </div>
      </div>
      <div
        ref={chrome?.setOverlaySlot}
        className={floating ? "pointer-events-auto" : undefined}
      />
    </div>
  );
}
