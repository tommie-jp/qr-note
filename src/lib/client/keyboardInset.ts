// ソフトキーボードが画面の下を覆っている高さ (docs/126 §1-33)。
//
// iPhone はキーボードが出てもレイアウトの画面 (innerHeight) を縮めず、見えている範囲
// (visualViewport) だけを縮めて送る。画面の下端に fixed で置いた下のペインは、その
// ままキーボードの下に隠れる。覆っている高さ = レイアウトの画面の下端 − 見えている範囲の下端
import { useEffect } from "react";

export const KEYBOARD_INSET_VAR = "--keyboard-inset";

export function keyboardInsetPx(
  layoutHeight: number,
  view: { offsetTop: number; height: number } | null,
): number {
  if (view === null) {
    return 0;
  }
  return Math.max(0, Math.round(layoutHeight - (view.offsetTop + view.height)));
}

// 打っている間だけ、覆っている高さを html の --keyboard-inset に書く。下のペインと
// その境界は、この値だけ上へ浮く (paneBox.ts・PaneResizer.tsx)。外れたら 0 に戻す。
// onChange … 値が変わった後に呼ぶ (欄を見える所へ送り直すため)
export function useKeyboardInset(active: boolean, onChange?: () => void): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const root = document.documentElement;
    const vv = window.visualViewport ?? null;
    const update = () => {
      root.style.setProperty(KEYBOARD_INSET_VAR, `${keyboardInsetPx(window.innerHeight, vv)}px`);
      onChange?.();
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      root.style.removeProperty(KEYBOARD_INSET_VAR);
    };
  }, [active, onChange]);
}
