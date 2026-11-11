"use client";

import { startTransition, useRef, useState } from "react";
import { refreshServerView } from "@/lib/client/navigation";
import {
  BOTTOM_BAR_FALLBACK_PX,
  COLLAPSE_FOLDER_CHARS,
  COLLAPSE_LINES,
  LINE_REM,
  PANE_SIZES,
  clampPaneSize,
  livePaneSizeLimit,
  rawPaneSizeFromPointer,
  type PaneKind,
} from "@/lib/prefs/paneSize";
import type { PaneMode } from "@/lib/prefs/paneMode";
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

// 画面の端に半分だけ出したタブの、指で触れる範囲 (docs/86 §4-26)。見えている半分は
// 10px しかないので、透明な ::before を画面の内側へ延ばし、画面の上で 44px にする
// (タブの箱は 20px で半分が画面の外。内側へ 34px 足すと 10 + 34 = 44px)
const COLLAPSED_TAB_HIT: Record<PaneKind, string> = {
  folder: "before:absolute before:inset-y-0 before:left-0 before:-right-[34px]",
  preview: "before:absolute before:inset-x-0 before:bottom-0 before:-top-[34px]",
};

// 押しただけ (ドラッグでない) とみなす動きの量 (px)
const CLICK_SLOP_PX = 4;

interface Drag {
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

// 隠したペインのタブ (docs/86 §4-21)。境界を引き切って (またはダブルクリックで) ペインを
// 隠した後も、タブを画面の端に半分だけ残す — フォルダーは左端に右半分、下のペインは
// 下端に上半分。引き出して離すとその大きさでペインを戻し (2 文字・2 行を超えたら)、
// 押すだけなら覚えている大きさで戻す。境界に沿った向き (縦のタブは上下、横のタブは
// 左右) にも動かせ、位置は開いているときのタブと同じ所に覚える。
//
// **タブは常に出す** (docs/86 §4-25)。全画面のノートの上にも出し、2・3 ペインで
// 下に何も開いていない (ノートも日の一覧も無い) ときも下端に出す。そのときは
// 開く物が無いので、引き出した高さを覚えるだけ (次に開くノートがその高さで出る)。
// 下のペインが出ている間は、そのペインの境界のタブがあるので隠す (globals.css が
// data-preview-pane を :has で見る。出す・出さないは DOM でしか判らない)
export function CollapsedPaneTabs() {
  const { mode } = usePaneMode();
  return (
    <>
      {mode !== "3" && <CollapsedTab kind="folder" openMode="3" />}
      <CollapsedTab kind="preview" openMode={mode === "1" ? "2" : null} />
    </>
  );
}

function CollapsedTab({
  kind,
  openMode,
}: {
  kind: PaneKind;
  // 戻す先の構成。null は構成を変えない (高さを覚えるだけ)
  openMode: PaneMode | null;
}) {
  // 引き出している間も共有の控えに流す (開いた境界のタブと同じ作り)
  const fraction = useTabPosition(kind);
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
    setPaneSize(kind, size);
    if (openMode === null) {
      return;
    }
    void switchPaneMode(openMode, () => {
      startTransition(refreshServerView);
    });
  };

  // 境界に沿った向きの範囲 (縦のタブ: ヘッダーの下〜下部バーの上、横のタブ: 画面の幅)
  const alongFraction = (x: number, y: number) => {
    const g = geometry(x, y);
    const tabPx = TAB_LENGTH_REM * g.rootFontSizePx;
    if (kind === "folder") {
      const top = headerBottomPx();
      return tabFraction(
        y,
        top,
        window.innerHeight - g.bottomBarPx - top,
        tabPx,
      );
    }
    return tabFraction(x, 0, window.innerWidth, tabPx);
  };

  const finish = (d: Drag) => {
    if (liveTabRef.current !== null) {
      setTabPosition(kind, liveTabRef.current);
      liveTabRef.current = null;
    }
    if (!d.moved) {
      open(clampPaneSize(kind, localStorageSize(kind)));
      return;
    }
    const g = geometry(d.x, d.y);
    const limit = livePaneSizeLimit(kind, {
      widthPx: window.innerWidth,
      heightPx: window.innerHeight,
      rootFontSizePx: g.rootFontSizePx,
      bottomBarPx: g.bottomBarPx,
      headerPx: headerBottomPx(),
    });
    const raw = Math.min(limit, rawPaneSizeFromPointer(kind, g));
    // 隠す目安 (2 文字・2 行) を超えて引き出したときだけ戻す
    const openedEnough =
      kind === "folder"
        ? d.x > COLLAPSE_FOLDER_CHARS * g.rootFontSizePx
        : window.innerHeight - g.bottomBarPx - d.y >
          COLLAPSE_LINES * LINE_REM * g.rootFontSizePx;
    if (openedEnough) {
      open(clampPaneSize(kind, raw));
    }
  };

  // 引き出している間はタブが指について動く。画面の外へは出さない (端で半分残る)
  const dragStyle = (d: Drag): React.CSSProperties =>
    kind === "folder"
      ? { left: Math.min(window.innerWidth, Math.max(0, d.x)) }
      : {
          top: Math.min(window.innerHeight, Math.max(headerBottomPx(), d.y)),
          bottom: "auto",
        };

  const restStyle: React.CSSProperties =
    kind === "folder"
      ? {
          left: 0,
          top: `calc(var(--header-h) + ${tabOffsetCss(fraction, "(100dvh - var(--header-h) - var(--bottom-bar-h))")})`,
        }
      : {
          bottom: "var(--bottom-bar-h)",
          left: tabOffsetCss(fraction, "100vw"),
        };

  const label =
    kind === "folder"
      ? "フォルダーを開く"
      : openMode === null
        ? "下のペインの高さ"
        : "下のペインを開く";
  const hint =
    openMode === null ? "引き出した高さで次のノートを開く" : "押すか引き出す";
  return (
    <>
      {/* 引き出している間は境界の線もタブについて動かす (docs/86 §4-23)。
        普段の境界と同じ灰色の線。押せない飾り */}
      {drag?.moved && <DragLine kind={kind} drag={drag} />}
      <button
        type="button"
        aria-label={label}
        title={`${label} (${hint})`}
        data-collapsed-tab={kind}
        style={drag?.moved ? { ...restStyle, ...dragStyle(drag) } : restStyle}
        className={`group fixed z-20 touch-none ${
          kind === "folder"
            ? "-translate-x-1/2 cursor-col-resize"
            : "translate-y-1/2 cursor-row-resize"
        } ${HANDLE_TAB[kind].shape} ${HANDLE_TAB_SKIN} ${COLLAPSED_TAB_HIT[kind]}`}
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
            setLiveTabPosition(kind, liveTabRef.current);
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
            setTabPosition(kind, liveTabRef.current);
            liveTabRef.current = null;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open(clampPaneSize(kind, localStorageSize(kind)));
          }
        }}
      >
        <span aria-hidden="true">{HANDLE_TAB[kind].glyph}</span>
      </button>
    </>
  );
}

// 引き出している間の境界の線。普段の境界と同じ色・太さで描く。縦はヘッダーの下から下部バーの上まで、横は画面の幅いっぱい
function DragLine({ kind, drag }: { kind: PaneKind; drag: Drag }) {
  const style: React.CSSProperties =
    kind === "folder"
      ? { left: Math.min(window.innerWidth, Math.max(0, drag.x)) }
      : {
          top: Math.min(window.innerHeight, Math.max(headerBottomPx(), drag.y)),
        };
  return (
    <span
      aria-hidden="true"
      data-collapsed-drag-line={kind}
      style={style}
      className={`pointer-events-none fixed z-20 ${DIVIDER_LINE_COLOR} ${
        kind === "folder"
          ? "top-[var(--header-h)] bottom-[var(--bottom-bar-h)] w-0.5 -translate-x-1/2"
          : "inset-x-0 h-0.5 -translate-y-1/2"
      }`}
    />
  );
}

// 覚えている寸法 (無ければ既定)。隠すときは掴む前の寸法に戻してから隠している
function localStorageSize(kind: PaneKind): number {
  try {
    return clampPaneSize(
      kind,
      localStorage.getItem(PANE_SIZES[kind].storageKey),
    );
  } catch {
    return PANE_SIZES[kind].default;
  }
}
