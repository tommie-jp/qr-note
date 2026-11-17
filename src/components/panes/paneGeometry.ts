// 境界 (PaneResizer) と隠したペインのタブ (CollapsedPaneTabs) が画面から読む寸法。
// PaneResizer から分けた (docs/128 §3-3)
import { BOTTOM_BAR_FALLBACK_PX, livePaneSizeLimit, type PaneKind } from "@/lib/prefs/paneSize";

export function readCssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

// ヘッダーの下端 (px)。--header-h は calc の式なので数としては読めない
export function headerBottomPx(): number {
  return document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
}

// ポインタの位置と、寸法の計算 (prefs/paneSize.ts) に渡す画面の大きさ
export function pointerGeometry(x: number, y: number) {
  return {
    clientX: x,
    clientY: y,
    rootFontSizePx: readCssPx("font-size", 16),
    viewportHeightPx: window.innerHeight,
    bottomBarPx: readCssPx("--bottom-bar-h", BOTTOM_BAR_FALLBACK_PX),
  };
}

// ドラッグ中に動かせる上限 (画面の端まで)
export function livePaneLimit(
  kind: PaneKind,
  geometry: { rootFontSizePx: number; bottomBarPx: number },
): number {
  return livePaneSizeLimit(kind, {
    widthPx: window.innerWidth,
    heightPx: window.innerHeight,
    rootFontSizePx: geometry.rootFontSizePx,
    bottomBarPx: geometry.bottomBarPx,
    headerPx: headerBottomPx(),
  });
}
