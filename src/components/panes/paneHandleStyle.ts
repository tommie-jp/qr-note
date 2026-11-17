// 境界 (PaneResizer) と隠したペインのタブ (CollapsedPaneTabs) の見た目。
// PaneResizer から分けた (docs/128 §3-3)
import type { CSSProperties } from "react";
import type { PaneKind } from "@/lib/prefs/paneSize";
import { tabOffsetCss } from "@/components/panes/paneTabPosition";

// 境界そのものの置き方。**ポインタ → 寸法の計算 (prefs/paneSize.ts) と対**で、
// どちらか片方だけ直すと掴む場所と動く量がずれる。
//
// 掴む帯は 8px 取り、境界の上に半分ずつ跨がせる (translate) —
// 線と同じ 1px では狙えないが、太い帯を見せると枠が二重に見える。
// z-20 … ペイン (z-10) より上。ヘッダー (z-20) とは場所が重ならない。
// touch-none … 指でなぞったときに画面ごとスクロールさせない。
// 見た目は普段は透明で、触れている間だけ色を出す (常時見える線は枠が担う)。
export const HANDLE_CLASS: Record<PaneKind, string> = {
  // フォルダーの境界はペインと同じ寿命 (3 ペインのときだけ描かれる) なので、
  // 幅では畳まない (docs/86 §4-9)
  folder:
    "fixed top-[var(--header-h)] bottom-[var(--bottom-bar-h)] left-[var(--folder-pane-w)] z-20 m-0 block w-2 -translate-x-1/2 cursor-col-resize touch-none",
  // 左端をフォルダーペインの右へ寄せるのは globals.css (ペインが出ている
  // 構成のときだけ効かせたいので :has で見る)
  // m-0 … 境界の帯もペインと同じ理由で親の余白を打ち消す (docs/86 §4-12)
  preview:
    "fixed inset-x-0 m-0 bottom-[calc(var(--bottom-bar-h)+var(--keyboard-inset,0px)+min(var(--preview-pane-h),var(--keyboard-pane-max,100vh)))] z-20 h-2 translate-y-1/2 cursor-row-resize touch-none",
};

// 掴む帯そのものは透明のまま。**境界の線は中の 2px が描く** (docs/86 §4-10) —
// 帯 (8px) を塗ると太い色帯になって、ペインの枠と二重に見える。
// 触れている間だけ帯を薄く色付けて「掴める場所」を示す
// 動かしている間は色を付けない (普段の境界のまま。ペインの継ぎ目が動いて見える)
export const HANDLE_SKIN =
  "group flex bg-transparent transition-colors focus-visible:bg-blue-400/40 focus-visible:outline-none";
export const HANDLE_SKIN_IDLE = "hover:bg-blue-400/30";

// 境界の線。**濃いめのグレイで常に見せる** — ペインの継ぎ目が判らないと、
// どこを掴めば動かせるのかも判らない。掴んでいる間は青にして、いま動かして
// いる境界がどれか判るようにする (帯の色付けと対)
export const HANDLE_LINE: Record<PaneKind, string> = {
  folder: "m-auto h-full w-0.5",
  preview: "m-auto h-0.5 w-full",
};

// 境界のつまみ (タブ)。8px の帯だけでは指でも マウスでも狙いにくいので、
// 線の上に掴みやすい大きさのタブを重ねる。帯の子なので、押せば帯の
// ドラッグ・ダブルクリックがそのまま働く (イベントは帯へ浮かぶ)。
// 帯から両側へはみ出して、ペインの端に少し重なる (z-20 で上に出る)。
// 境界に沿った位置は端末ごとに覚え、タブを掴んで境界に沿って動かせる
// (docs/86 §4-21。縦の境界は上下、横の境界は左右)。長さ (h-12 / w-12) は TAB_LENGTH_REM と対
export const HANDLE_TAB: Record<PaneKind, { shape: string; glyph: string }> = {
  folder: { shape: "h-12 w-5 text-base", glyph: "︙" },
  preview: { shape: "h-5 w-12 text-base", glyph: "⋯" },
};

// 指で触れる範囲 (docs/86 §4-26)。タブの見た目 (幅 20px) のままでは iPhone で狙えないので、
// 透明な ::before で細い向きを 44px (iOS の標準の的) まで広げる。見た目は変えない。
// 疑似要素はタブの一部として当たるので、押せば帯のドラッグがそのまま働く
export const HANDLE_TAB_HIT: Record<PaneKind, string> = {
  folder: "before:absolute before:inset-y-0 before:-inset-x-3",
  preview: "before:absolute before:inset-x-0 before:-inset-y-3",
};

// 帯の中のタブの置き方 (境界の線の上に中心を載せる。沿った向きの位置は tabStyle)
export const HANDLE_TAB_PLACE: Record<PaneKind, string> = {
  folder: "left-1/2 -translate-x-1/2",
  preview: "top-1/2 -translate-y-1/2",
};

export const HANDLE_TAB_SKIN =
  "flex items-center justify-center rounded border border-gray-400 bg-gray-100 leading-none text-gray-600 shadow-sm transition-colors group-hover:border-blue-500 group-hover:bg-blue-50 group-hover:text-blue-700 group-active:bg-blue-100";


// 境界に沿ったタブの位置 (帯の中で。帯の長さからタブの長さを引いた範囲に割合を掛ける)
export function tabStyle(kind: PaneKind, fraction: number): CSSProperties {
  const offset = tabOffsetCss(fraction, "100%");
  return kind === "folder" ? { top: offset } : { left: offset };
}

// 引き切って「離すと隠す」位置まで来ている間のタブ (docs/86 §4-19)
export const HANDLE_TAB_COLLAPSE = "border-amber-600 bg-amber-100 text-amber-800";

// 境界の線の色。隠したペインの引き出し中の線 (CollapsedPaneTabs) もこれで描く
export const DIVIDER_LINE_COLOR = "bg-gray-400";
export const HANDLE_LINE_SKIN = `${DIVIDER_LINE_COLOR} transition-colors`;
export const HANDLE_LINE_SKIN_IDLE = "group-hover:bg-blue-500";
