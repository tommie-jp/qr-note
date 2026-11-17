// 境界で動かしたペインの寸法の控え (localStorage と、塞がれているときの受け皿)。
// PaneResizer から分けた (docs/128 §3-3)
import { PANE_SIZES, clampPaneSize, paneSizeValue, type PaneKind } from "@/lib/prefs/paneSize";

// 保存された寸法は「React の外にある状態」なので、useSyncExternalStore で
// 読む。サーバでは既定を返し、マウント後に保存値へ切り替わる
// (state を effect で上書きすると、その 1 往復で読み上げ値がちらつく)。
//
// memory … localStorage を塞いでいるブラウザ (iOS のプライベート閲覧など)
// の受け皿。覚えられないだけで、そのセッション中は動かした寸法を保つ
const memory = new Map<PaneKind, number>();
const listeners = new Set<() => void>();

export function subscribePaneSize(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function readStoredPaneSize(kind: PaneKind): number {
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

// 寸法を CSS 変数に当てる (覚えはしない)
export function applyPaneSizeVar(kind: PaneKind, size: number): void {
  document.documentElement.style.setProperty(PANE_SIZES[kind].cssVar, paneSizeValue(kind, size));
}

// 寸法を当てて覚える。隠れたペインを端のタブから戻すとき (CollapsedPaneTabs) も使う
export function setPaneSize(kind: PaneKind, size: number): void {
  applyPaneSizeVar(kind, size);
  storePaneSize(kind, size);
}

export function storePaneSize(kind: PaneKind, size: number): void {
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
