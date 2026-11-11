// いま見えている範囲 (docs/126 §1-32)。visualViewport が無い環境では画面全体
import type { View } from "../event/placePopover";

export function visibleView(): View {
  const vv = window.visualViewport;
  if (vv === null || vv === undefined) {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
}

// 見えている範囲が変わったら (キーボードの出入り・送り) 呼ぶ。外す関数を返す
export function onVisibleViewChange(listener: () => void): () => void {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", listener);
  vv?.addEventListener("scroll", listener);
  return () => {
    vv?.removeEventListener("resize", listener);
    vv?.removeEventListener("scroll", listener);
  };
}
