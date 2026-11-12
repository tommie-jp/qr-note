"use client";

import { startTransition, useRef, useState } from "react";
import { refreshServerView } from "@/lib/client/navigation";
import {
  BOTTOM_BAR_FALLBACK_PX,
  COLLAPSE_FOLDER_CHARS,
  PANE_SIZES,
  clampPaneSize,
  livePaneSizeLimit,
  rawPaneSizeFromPointer,
} from "@/lib/prefs/paneSize";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import {
  DIVIDER_LINE_COLOR,
  HANDLE_TAB,
  HANDLE_TAB_SKIN,
  headerBottomPx,
  readCssPx,
  setPaneSize,
} from "@/components/panes/PaneResizer";
import { switchPaneMode } from "@/components/panes/switchPaneMode";
import {
  TAB_LENGTH_REM,
  setLiveTabPosition,
  setTabPosition,
  tabFraction,
  tabOffsetCss,
  useTabPosition,
} from "@/components/panes/paneTabPosition";

// 画面の端のタブは**全体を見せる** (docs/86 §4-27)。半分だけ (見えるのは 10px) では、
// 触れる範囲を広げても iPhone で掴みにくかった。タブの幅の半分 (w-5 の半分) だけ
// 画面の内側へ寄せ、中心をそこに置く (ドラッグ中に指へ中心を合わせる作りと同じ)
const TAB_HALF_REM = 0.625;

// 指で触れる範囲 (docs/86 §4-26)。透明な ::before を画面の内側へ 24px 延ばし、
// 画面の上で 20 + 24 = 44px (iOS の標準の的) にする
const TAB_HIT = "before:absolute before:inset-y-0 before:left-0 before:-right-6";

// 押しただけ (ドラッグでない) とみなす動きの量 (px)
const CLICK_SLOP_PX = 4;

interface Drag {
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

// 隠したフォルダーのタブ (docs/86 §4-21)。フォルダーを隠した構成 (1・2 ペイン) では、
// 左端にタブを残す。引き出して離すとその幅で 3 ペインに戻し (2 文字を超えたら)、
// 押すだけなら覚えている幅で戻す。上下にも動かせ、位置は開いているときのタブと同じ所に覚える。
//
// **下端の横のタブはやめた** (§4-31)。iPhone の下端はホームへ戻るスワイプとぶつかり、
// 浮かせると宙に浮いて邪魔だった。下のペインはヘッダーの構成の釦・日やノートを押して開く
export function CollapsedPaneTabs() {
  const { mode } = usePaneMode();
  return mode === "3" ? null : <CollapsedFolderTab />;
}

function CollapsedFolderTab() {
  // 引き出している間も共有の控えに流す (開いた境界のタブと同じ作り)
  const fraction = useTabPosition("folder");
  const [drag, setDrag] = useState<Drag | null>(null);
  const liveTabRef = useRef<number | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const geometry = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    rootFontSizePx: readCssPx("font-size", 16),
    viewportHeightPx: window.innerHeight,
    bottomBarPx: readCssPx("--bottom-bar-h", BOTTOM_BAR_FALLBACK_PX),
  });

  const open = (size: number) => {
    setPaneSize("folder", size);
    void switchPaneMode("3", () => {
      startTransition(refreshServerView);
    });
  };

  // 境界に沿った向き (上下) の位置。ヘッダーの下〜下部バーの上
  const alongFraction = (x: number, y: number) => {
    const g = geometry(x, y);
    const top = headerBottomPx();
    return tabFraction(
      y,
      top,
      window.innerHeight - g.bottomBarPx - top,
      TAB_LENGTH_REM * g.rootFontSizePx,
    );
  };

  const finish = (d: Drag) => {
    if (liveTabRef.current !== null) {
      setTabPosition("folder", liveTabRef.current);
      liveTabRef.current = null;
    }
    if (!d.moved) {
      open(storedFolderWidth());
      return;
    }
    const g = geometry(d.x, d.y);
    const limit = livePaneSizeLimit("folder", {
      widthPx: window.innerWidth,
      heightPx: window.innerHeight,
      rootFontSizePx: g.rootFontSizePx,
      bottomBarPx: g.bottomBarPx,
      headerPx: headerBottomPx(),
    });
    // 隠す目安 (2 文字) を超えて引き出したときだけ戻す
    if (d.x > COLLAPSE_FOLDER_CHARS * g.rootFontSizePx) {
      open(clampPaneSize("folder", Math.min(limit, rawPaneSizeFromPointer("folder", g))));
    }
  };

  // 引き出している間はタブが指について動く。画面の外へは出さない (端でも全体が見える)
  const dragStyle = (d: Drag): React.CSSProperties => {
    const half = TAB_HALF_REM * readCssPx("font-size", 16);
    return { left: Math.min(window.innerWidth - half, Math.max(half, d.x)) };
  };

  const restStyle: React.CSSProperties = {
    left: `${TAB_HALF_REM}rem`,
    top: `calc(var(--header-h) + ${tabOffsetCss(fraction, "(100dvh - var(--header-h) - var(--bottom-bar-h))")})`,
  };

  const label = "フォルダーを開く";
  return (
    <>
      {/* 引き出している間は境界の線もタブについて動かす (docs/86 §4-23)。
        普段の境界と同じ灰色の線。押せない飾り */}
      {drag?.moved && <DragLine drag={drag} />}
      <button
        type="button"
        aria-label={label}
        title={`${label} (押すか引き出す)`}
        data-collapsed-tab="folder"
        style={drag?.moved ? { ...restStyle, ...dragStyle(drag) } : restStyle}
        className={`group fixed z-20 touch-none -translate-x-1/2 cursor-col-resize ${HANDLE_TAB.folder.shape} ${HANDLE_TAB_SKIN} ${TAB_HIT}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const d = {
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          dragRef.current = d;
          setDrag(d);
        }}
        onPointerMove={(event) => {
          const current = dragRef.current;
          if (current === null) return;
          const moved =
            current.moved ||
            Math.hypot(
              event.clientX - current.startX,
              event.clientY - current.startY,
            ) > CLICK_SLOP_PX;
          const d = { ...current, x: event.clientX, y: event.clientY, moved };
          dragRef.current = d;
          setDrag(d);
          if (moved) {
            liveTabRef.current = alongFraction(event.clientX, event.clientY);
            setLiveTabPosition("folder", liveTabRef.current);
          }
        }}
        onPointerUp={() => {
          const d = dragRef.current;
          dragRef.current = null;
          setDrag(null);
          if (d !== null) {
            finish(d);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDrag(null);
          // 取り消されても、動かした所にタブを残す
          if (liveTabRef.current !== null) {
            setTabPosition("folder", liveTabRef.current);
            liveTabRef.current = null;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open(storedFolderWidth());
          }
        }}
      >
        <span aria-hidden="true">{HANDLE_TAB.folder.glyph}</span>
      </button>
    </>
  );
}

// 引き出している間の境界の線。普段の境界と同じ色・太さで、ヘッダーの下から下部バーの上まで
function DragLine({ drag }: { drag: Drag }) {
  return (
    <span
      aria-hidden="true"
      data-collapsed-drag-line="folder"
      style={{ left: Math.min(window.innerWidth, Math.max(0, drag.x)) }}
      className={`pointer-events-none fixed top-[var(--header-h)] bottom-[var(--bottom-bar-h)] z-20 w-0.5 -translate-x-1/2 ${DIVIDER_LINE_COLOR}`}
    />
  );
}

// 覚えている幅 (無ければ既定)。隠すときは掴む前の幅に戻してから隠している
function storedFolderWidth(): number {
  try {
    return clampPaneSize("folder", localStorage.getItem(PANE_SIZES.folder.storageKey));
  } catch {
    return PANE_SIZES.folder.default;
  }
}
