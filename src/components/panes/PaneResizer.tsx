"use client";

import { useSyncExternalStore } from "react";
import { PANE_SIZES, type PaneKind } from "@/lib/prefs/paneSize";
import {
  HANDLE_CLASS,
  HANDLE_LINE,
  HANDLE_LINE_SKIN,
  HANDLE_LINE_SKIN_IDLE,
  HANDLE_SKIN,
  HANDLE_SKIN_IDLE,
  HANDLE_TAB,
  HANDLE_TAB_COLLAPSE,
  HANDLE_TAB_HIT,
  HANDLE_TAB_PLACE,
  HANDLE_TAB_SKIN,
  tabStyle,
} from "@/components/panes/paneHandleStyle";
import { readStoredPaneSize, subscribePaneSize } from "@/components/panes/paneSizeStore";
import { usePaneDrag } from "@/components/panes/usePaneDrag";

// 境界のつまみ (タブ)。境界に沿った位置は tabPosition。引き切って隠す位置では色を変える
function HandleTab({
  kind,
  tabPosition,
  collapse,
  dragging,
}: {
  kind: PaneKind;
  tabPosition: number;
  collapse: boolean;
  dragging: boolean;
}) {
  return (
    <span
      aria-hidden
      data-pane-resizer-tab=""
      style={tabStyle(kind, tabPosition)}
      className={`absolute ${HANDLE_TAB_PLACE[kind]} ${HANDLE_TAB[kind].shape} ${HANDLE_TAB_SKIN} ${HANDLE_TAB_HIT[kind]} ${
        collapse ? HANDLE_TAB_COLLAPSE : dragging ? "border-blue-600 bg-blue-100 text-blue-700" : ""
      }`}
    >
      {HANDLE_TAB[kind].glyph}
    </span>
  );
}

// 見た目の定数は paneHandleStyle.ts、寸法の控えは paneSizeStore.ts、
// ドラッグ・キー操作は usePaneDrag.ts (docs/128 §3-3)

// 検索 3 ペインの境界 (docs/86 §4-2)。ドラッグと矢印キーでペインの寸法を
// 変え、localStorage に覚える。
//
// 動かすのは CSS 変数 1 つだけ。ペインの寸法・一覧の底上げ・広幅補正は
// もとから同じ変数を見ているので、ここは「変数を書き換える」しかしない。
// **React の state では動かさない** — 1 フレームごとに再描画すると、
// 一覧に数百行ある状態でドラッグが引っかかる。state は読み上げ (aria) と
// キー操作の起点のためだけに持つ。
// 境界は幅では畳まない (docs/86 §4-9)。ノートが全画面のときは呼ぶ側が描かない
export function PaneResizer({ kind }: { kind: PaneKind }) {
  const spec = PANE_SIZES[kind];
  // サーバは寸法を知らないので既定を返す。見た目が跳ねることはない —
  // 実際の寸法は <head> の先回りスクリプトが当て済みで、ここが追いつくのは
  // 読み上げ (aria) とキー操作の起点だけ
  const size = useSyncExternalStore(
    subscribePaneSize,
    () => readStoredPaneSize(kind),
    () => spec.default,
  );
  const { dragging, collapse, tabPosition, moveTo, endDrag, startDrag, hideByDoubleClick, onKeyDown } =
    usePaneDrag(kind, size);

  return (
    <div
      // separator に tabindex を付けると「動かせる境界」として読み上げられる
      // (WAI-ARIA の window splitter)。値は保存されている寸法そのもの
      role="separator"
      aria-orientation={spec.orientation}
      aria-label={spec.label}
      aria-valuenow={size}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      title={`${spec.label} (ドラッグか矢印キーで調整、Enter で既定に戻す。ダブルクリックか端まで引き切って離すとペインを隠す)`}
      data-collapse={collapse?.hide}
      className={`${HANDLE_CLASS[kind]} ${HANDLE_SKIN} ${
        dragging ? "" : HANDLE_SKIN_IDLE
      }`}
      onPointerDown={startDrag}
      onPointerMove={(event) => {
        if (!dragging) return;
        moveTo(event);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // ダブルクリックでペインを隠す (docs/86 §4-19)
      onDoubleClick={hideByDoubleClick}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={`${HANDLE_LINE[kind]} ${HANDLE_LINE_SKIN} ${
          dragging ? "" : HANDLE_LINE_SKIN_IDLE
        }`}
      />
      <HandleTab kind={kind} tabPosition={tabPosition} collapse={collapse !== null} dragging={dragging} />
    </div>
  );
}
