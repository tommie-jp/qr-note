"use client";

import { startTransition, useRef, useState } from "react";
import { navigate, refreshServerView } from "@/lib/client/navigation";
import {
  PANE_SIZES,
  clampPaneSize,
  paneCollapse,
  paneHideByDoubleClick,
  rawPaneSizeFromPointer,
  type PaneCollapse,
  type PaneKind,
} from "@/lib/prefs/paneSize";
import { switchPaneMode } from "@/components/panes/switchPaneMode";
import { listHrefFromItemUrl, notifyPreviewPaneHidden } from "@/components/panes/previewPaneHidden";
import { allowsSinglePane } from "@/modules/registry";
import { livePaneLimit, pointerGeometry, readCssPx } from "@/components/panes/paneGeometry";
import { applyPaneSizeVar, storePaneSize } from "@/components/panes/paneSizeStore";
import {
  TAB_LENGTH_REM,
  setLiveTabPosition,
  setTabPosition,
  tabFraction,
  useTabPosition,
} from "@/components/panes/paneTabPosition";

// 境界 (PaneResizer) のドラッグ・ダブルクリック・キー操作。PaneResizer から分けた (docs/128 §3-3)

// いまの表示が 1 ペインを許すか (カレンダーは許さない。docs/86 §4-28)。押した時の URL で決める
function allowSingleNow(): boolean {
  return allowsSinglePane(new URLSearchParams(location.search));
}

// いまの構成 (ペインの根の data-panes)。境界はフォルダーペイン (構成の文脈の外) にも
// 描かれるので、文脈ではなく画面から読む
function currentPaneMode(): string {
  return document.querySelector("[data-panes]")?.getAttribute("data-panes") ?? "";
}

// 一覧の器の上端 (上の一覧が何行残るかを測る起点)。見つからなければヘッダーの下
function resultsTopPx(): number {
  const box = document.querySelector("[data-results-scroll]")?.getBoundingClientRect();
  return box?.top ?? readCssPx("--header-h", 0);
}

// 引き切って離した: 狭くなった側を隠して構成を 1 つ減らす (docs/86 §4-19)。
// 寸法を掴む前に戻すのは呼ぶ側
function hidePaneOf(target: PaneCollapse): void {
  if (target.hide === "preview") {
    // 下のペインの中身を閉じる。ノートは URL が正なので一覧の URL へ戻す
    notifyPreviewPaneHidden();
    const listHref = listHrefFromItemUrl(new URL(location.href));
    if (listHref !== null) {
      navigate(listHref, { replace: true });
    }
  }
  void switchPaneMode(target.mode, () => {
    startTransition(refreshServerView);
  });
}

// キーで動かした先の寸法。動かさないキーは null
function keyedPaneSize(kind: PaneKind, key: string, size: number): number | null {
  const spec = PANE_SIZES[kind];
  // 矢印の向きは境界の動く向きに合わせる。プレビューは上へ引くほど
  // 広くなる (境界が上がる) ので ↑ が +
  const byKey: Record<string, number | undefined> =
    spec.orientation === "vertical"
      ? { ArrowLeft: -spec.step, ArrowRight: spec.step }
      : { ArrowUp: spec.step, ArrowDown: -spec.step };
  const delta = byKey[key];
  if (delta !== undefined) {
    return clampPaneSize(kind, size + delta);
  }
  // Home / End は端まで、Enter は既定へ
  return key === "Home" ? spec.min : key === "End" ? spec.max : key === "Enter" ? spec.default : null;
}

// 掴んで動かした: 寸法を指について動かし、タブも動かす。引き切っていま離すと隠すなら
// その中身を返す
function dragTo(
  kind: PaneKind,
  event: React.PointerEvent,
  apply: (next: number) => void,
  moveTab: (event: React.PointerEvent, rootFontSizePx: number) => void,
): PaneCollapse | null {
  const geometry = pointerGeometry(event.clientX, event.clientY);
  // ドラッグ中は 0 から画面の端まで指について動かす (docs/86 §4-21)。
  // 上下限に寄せるのは離したとき
  const limit = livePaneLimit(kind, geometry);
  apply(Math.min(limit, Math.max(0, rawPaneSizeFromPointer(kind, geometry))));
  moveTab(event, geometry.rootFontSizePx);
  return paneCollapse(
    kind,
    { ...geometry, resultsTopPx: resultsTopPx() },
    currentPaneMode(),
    allowSingleNow(),
  );
}

// 矢印・Home・End・Enter で寸法を変えて覚える
function paneKeyHandler(kind: PaneKind, size: number, commit: (next: number) => void) {
  return (event: React.KeyboardEvent) => {
    const next = keyedPaneSize(kind, event.key, size);
    if (next !== null) {
      event.preventDefault();
      commit(next);
    }
  };
}

// ドラッグ中は本文の選択とカーソルの点滅を止める
function lockBodyForDrag(kind: PaneKind): void {
  document.body.style.setProperty("user-select", "none");
  document.body.style.setProperty(
    "cursor",
    PANE_SIZES[kind].orientation === "vertical" ? "col-resize" : "row-resize",
  );
}

function unlockBody(): void {
  document.body.style.removeProperty("user-select");
  document.body.style.removeProperty("cursor");
}

// ドラッグ中の現在値。1 フレームごとに state を更新すると、一覧に数百行
// ある状態で引っかかるので、動かしている間は ref と CSS 変数だけで進める
function usePaneSizeWriter(kind: PaneKind) {
  const sizeRef = useRef<number>(PANE_SIZES[kind].default);
  const apply = (next: number) => {
    sizeRef.current = next;
    applyPaneSizeVar(kind, next);
  };
  const commit = (next: number) => {
    apply(next);
    storePaneSize(kind, next);
  };
  return { sizeRef, apply, commit };
}

// 境界に沿ったタブの位置。動かしている間も共有の控えに流す (重なった境界のタブも動く)
function useHandleTab(kind: PaneKind) {
  const tabPosition = useTabPosition(kind);
  // 動かしている間の最後の位置 (離したら覚える)
  const liveTabRef = useRef<number | null>(null);
  // タブを掴んでドラッグしているか (帯の他の所を掴んだときはタブを動かさない)
  const grabbedTabRef = useRef(false);
  const grabTab = (target: EventTarget) => {
    grabbedTabRef.current = target instanceof Element && target.closest("[data-pane-resizer-tab]") !== null;
  };
  const moveTab = (event: React.PointerEvent, rootFontSizePx: number) => {
    if (!grabbedTabRef.current) {
      return;
    }
    const band = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const tabPx = TAB_LENGTH_REM * rootFontSizePx;
    const fraction =
      kind === "folder"
        ? tabFraction(event.clientY, band.top, band.height, tabPx)
        : tabFraction(event.clientX, band.left, band.width, tabPx);
    liveTabRef.current = fraction;
    setLiveTabPosition(kind, fraction);
  };
  const finishTab = () => {
    if (liveTabRef.current !== null) {
      setTabPosition(kind, liveTabRef.current);
      liveTabRef.current = null;
    }
    grabbedTabRef.current = false;
  };
  return { tabPosition, grabTab, moveTab, finishTab };
}

// size … 保存されている寸法 (キー操作と掴んだときの起点)
export function usePaneDrag(kind: PaneKind, size: number) {
  const { sizeRef, apply, commit } = usePaneSizeWriter(kind);
  const [dragging, setDragging] = useState(false);
  // 掴んだときの寸法 (引き切って隠したら、ここへ戻してから構成を変える)
  const startRef = useRef<number>(PANE_SIZES[kind].default);
  // 引き切っていま離すと隠すなら、その中身。ドラッグ中だけ
  const [collapse, setCollapse] = useState<PaneCollapse | null>(null);
  const tab = useHandleTab(kind);

  const moveTo = (event: React.PointerEvent) => {
    const next = dragTo(kind, event, apply, tab.moveTab);
    if (next?.hide !== collapse?.hide) {
      setCollapse(next);
    }
  };

  // 引き切って離した: 寸法は掴む前に戻し (次にペインを出したとき端に張り付かない)、
  // 狭くなった側を隠して構成を 1 つ減らす (docs/86 §4-19)
  const hidePane = (target: PaneCollapse) => {
    commit(startRef.current);
    hidePaneOf(target);
  };

  // ドラッグ中は本文の選択とカーソルの点滅を止める。帯から指が外れても
  // 掴んだままにするのは setPointerCapture の役目
  const endDrag = (event: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    setCollapse(null);
    unlockBody();
    tab.finishTab();
    // 取り消し (pointercancel) では隠さない
    if (collapse !== null && event.type === "pointerup") {
      hidePane(collapse);
      return;
    }
    // ドラッグ中は上下限の外まで動かしているので、離したら寄せる
    commit(clampPaneSize(kind, sizeRef.current));
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // 掴んだ瞬間は動かさない (押しただけで寸法が飛ばないように)。
    // 主ボタン以外は無視する
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    tab.grabTab(event.target);
    // 掴んだ時点の値から始める (ドラッグ中はここから ref だけで進む)
    sizeRef.current = size;
    startRef.current = size;
    setDragging(true);
    lockBodyForDrag(kind);
  };

  // ダブルクリックでペインを隠す (docs/86 §4-19)。フォルダーの境界はフォルダー、
  // 一覧とノートの境界は下のペイン。隠すペインが無い構成では何もしない
  const hideByDoubleClick = () => {
    const target = paneHideByDoubleClick(kind, currentPaneMode(), allowSingleNow());
    if (target !== null) {
      hidePane(target);
    }
  };

  const onKeyDown = paneKeyHandler(kind, size, commit);

  return { dragging, collapse, tabPosition: tab.tabPosition, moveTo, endDrag, startDrag, hideByDoubleClick, onKeyDown };
}
