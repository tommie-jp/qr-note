"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  BOTTOM_BAR_FALLBACK_PX,
  PANE_SIZES,
  clampPaneSize,
  paneSizeFromPointer,
  paneSizeValue,
  type PaneKind,
} from "@/lib/paneSize";

// 境界そのものの置き方。**ポインタ → 寸法の計算 (paneSize.ts) と対**で、
// どちらか片方だけ直すと掴む場所と動く量がずれる。
//
// 掴む帯は 8px 取り、境界の上に半分ずつ跨がせる (translate) —
// 線と同じ 1px では狙えないが、太い帯を見せると枠が二重に見える。
// z-20 … ペイン (z-10) より上。ヘッダー (z-20) とは場所が重ならない。
// touch-none … 指でなぞったときに画面ごとスクロールさせない。
// 見た目は普段は透明で、触れている間だけ色を出す (常時見える線は枠が担う)。
const HANDLE_CLASS: Record<PaneKind, string> = {
  folder:
    "fixed top-[var(--header-h)] bottom-[var(--bottom-bar-h)] left-[var(--folder-pane-w)] z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none xl:block",
  // 左端をフォルダーペインの右へ寄せるのは globals.css (ペインが出ている
  // 構成のときだけ効かせたいので :has で見る)
  preview:
    "fixed inset-x-0 bottom-[calc(var(--bottom-bar-h)+var(--preview-pane-h))] z-20 hidden h-2 translate-y-1/2 cursor-row-resize touch-none lg:block",
};

const HANDLE_SKIN =
  "bg-transparent transition-colors hover:bg-blue-400/40 active:bg-blue-500/50 focus-visible:bg-blue-400/60 focus-visible:outline-none";

function readCssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

// 保存された寸法は「React の外にある状態」なので、useSyncExternalStore で
// 読む。サーバでは既定を返し、マウント後に保存値へ切り替わる
// (state を effect で上書きすると、その 1 往復で読み上げ値がちらつく)。
//
// memory … localStorage を塞いでいるブラウザ (iOS のプライベート閲覧など)
// の受け皿。覚えられないだけで、そのセッション中は動かした寸法を保つ
const memory = new Map<PaneKind, number>();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readStored(kind: PaneKind): number {
  const remembered = memory.get(kind);
  if (remembered !== undefined) {
    return remembered;
  }
  try {
    return clampPaneSize(kind, localStorage.getItem(PANE_SIZES[kind].storageKey));
  } catch {
    return PANE_SIZES[kind].default;
  }
}

function storePaneSize(kind: PaneKind, size: number): void {
  memory.set(kind, size);
  try {
    localStorage.setItem(PANE_SIZES[kind].storageKey, String(size));
  } catch {
    // 覚えられなくても寸法は変えられたので、ここでは何も出さない
    // (テキストサイズと同じ判断)
  }
  for (const onChange of listeners) {
    onChange();
  }
}

// 検索 3 ペインの境界 (docs/86 §4-2)。ドラッグと矢印キーでペインの寸法を
// 変え、localStorage に覚える。
//
// 動かすのは CSS 変数 1 つだけ。ペインの寸法・一覧の底上げ・広幅補正は
// もとから同じ変数を見ているので、ここは「変数を書き換える」しかしない。
// **React の state では動かさない** — 1 フレームごとに再描画すると、
// 一覧に数百行ある状態でドラッグが引っかかる。state は読み上げ (aria) と
// キー操作の起点のためだけに持つ。
export function PaneResizer({ kind }: { kind: PaneKind }) {
  const spec = PANE_SIZES[kind];
  // サーバは寸法を知らないので既定を返す。見た目が跳ねることはない —
  // 実際の寸法は <head> の先回りスクリプトが当て済みで、ここが追いつくのは
  // 読み上げ (aria) とキー操作の起点だけ
  const size = useSyncExternalStore(
    subscribe,
    () => readStored(kind),
    () => spec.default,
  );
  // ドラッグ中の現在値。1 フレームごとに state を更新すると、一覧に数百行
  // ある状態で引っかかるので、動かしている間は ref と CSS 変数だけで進める
  const sizeRef = useRef<number>(spec.default);
  const [dragging, setDragging] = useState(false);

  const apply = (next: number) => {
    sizeRef.current = next;
    document.documentElement.style.setProperty(
      spec.cssVar,
      paneSizeValue(kind, next),
    );
  };

  const commit = (next: number) => {
    apply(next);
    storePaneSize(kind, next);
  };

  const moveTo = (event: React.PointerEvent) => {
    apply(
      paneSizeFromPointer(kind, {
        clientX: event.clientX,
        clientY: event.clientY,
        rootFontSizePx: readCssPx("font-size", 16),
        viewportHeightPx: window.innerHeight,
        bottomBarPx: readCssPx("--bottom-bar-h", BOTTOM_BAR_FALLBACK_PX),
      }),
    );
  };

  // ドラッグ中は本文の選択とカーソルの点滅を止める。帯から指が外れても
  // 掴んだままにするのは setPointerCapture の役目
  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    storePaneSize(kind, sizeRef.current);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // 矢印の向きは境界の動く向きに合わせる。プレビューは上へ引くほど
    // 広くなる (境界が上がる) ので ↑ が +
    const byKey: Record<string, number | undefined> =
      spec.orientation === "vertical"
        ? { ArrowLeft: -spec.step, ArrowRight: spec.step }
        : { ArrowUp: spec.step, ArrowDown: -spec.step };
    const delta = byKey[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      commit(clampPaneSize(kind, size + delta));
      return;
    }
    // Home / End は端まで、Enter は既定へ (ダブルクリックと同じ)
    const jump =
      event.key === "Home"
        ? spec.min
        : event.key === "End"
          ? spec.max
          : event.key === "Enter"
            ? spec.default
            : null;
    if (jump !== null) {
      event.preventDefault();
      commit(jump);
    }
  };

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
      title={`${spec.label} (ドラッグか矢印キーで調整、ダブルクリックで既定に戻す)`}
      className={`${HANDLE_CLASS[kind]} ${HANDLE_SKIN} ${
        dragging ? "bg-blue-500/50" : ""
      }`}
      onPointerDown={(event) => {
        // 掴んだ瞬間は動かさない (押しただけで寸法が飛ばないように)。
        // 主ボタン以外は無視する
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        // 掴んだ時点の値から始める (ドラッグ中はここから ref だけで進む)
        sizeRef.current = size;
        setDragging(true);
        document.body.style.setProperty("user-select", "none");
        document.body.style.setProperty(
          "cursor",
          spec.orientation === "vertical" ? "col-resize" : "row-resize",
        );
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        moveTo(event);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => commit(spec.default)}
      onKeyDown={onKeyDown}
    />
  );
}
