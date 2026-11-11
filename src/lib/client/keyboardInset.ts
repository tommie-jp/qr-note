// ソフトキーボードが画面の下を覆っている高さ (docs/126 §1-33)。
//
// iPhone はキーボードが出てもレイアウトの画面 (innerHeight) を縮めず、見えている範囲
// (visualViewport) だけを縮めて送る。画面の下端に fixed で置いた下のペインは、その
// ままキーボードの下に隠れる。覆っている高さ = レイアウトの画面の下端 − 見えている範囲の下端
import { useEffect } from "react";

export const KEYBOARD_INSET_VAR = "--keyboard-inset";
// キーボードが出ている間の下部ペインの高さの上限 (docs/126 §1-34)。持ち上げたペインの
// 上端がヘッダーの下より上へ出ないよう、見えている範囲からヘッダーの分を引いた高さ
export const KEYBOARD_PANE_MAX_VAR = "--keyboard-pane-max";
// 持ち上げている間の目印 (html の属性)。下部ペインはふだん重なり順が一番下 (z-0) で、
// 一覧に場所を空けてもらっている。持ち上げるとカレンダーの見出し (sticky z-10) や
// マス目の上に入り込み、その下に潜った (§1-35)。globals.css がこの目印でペインを上げる
export const KEYBOARD_LIFT_ATTR = "data-keyboard-lift";

// headerBottom … ヘッダーの下端 (レイアウトの座標)。送られて見えている範囲の上端が
// それより下なら、ヘッダーは見えていないので引かない
export function keyboardPaneMaxPx(
  view: { offsetTop: number; height: number },
  headerBottom: number,
): number {
  return Math.max(0, Math.round(view.height - Math.max(0, headerBottom - view.offsetTop)));
}

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
// 背の高いペインは浮かせると上端が画面の外へ出るので、--keyboard-pane-max で縮める (§1-34)。
// onChange … 値が変わった後に呼ぶ (欄を見える所へ送り直すため)
export function useKeyboardInset(active: boolean, onChange?: () => void): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const root = document.documentElement;
    const vv = window.visualViewport ?? null;
    const update = () => {
      const inset = keyboardInsetPx(window.innerHeight, vv);
      root.style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`);
      root.toggleAttribute(KEYBOARD_LIFT_ATTR, inset > 0);
      if (vv !== null && inset > 0) {
        const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
        // getBoundingClientRect はレイアウトの座標なので、そのまま比べられる
        root.style.setProperty(KEYBOARD_PANE_MAX_VAR, `${keyboardPaneMaxPx(vv, header)}px`);
      } else {
        root.style.removeProperty(KEYBOARD_PANE_MAX_VAR);
      }
      onChange?.();
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      root.style.removeProperty(KEYBOARD_INSET_VAR);
      root.style.removeProperty(KEYBOARD_PANE_MAX_VAR);
      root.removeAttribute(KEYBOARD_LIFT_ATTR);
    };
  }, [active, onChange]);
}
