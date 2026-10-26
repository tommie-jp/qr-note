import type { NotePaneLayout } from "@/lib/prefs/paneMode";

// ノートのペインの器の置き方 (PreviewPane と画像ビューアのペインが共有する。
// docs/116 §3)。**z の高さが要点** (docs/86 §4-9):
//   下部ペイン … z-0。下部バー (z-10) より下に置く — 長押しメニューは
//     バーの上へせり上がるので、ペインと同層だと DOM 順で負けて隠れる。
//   全画面 … z-10。バーごと覆う (ノートを読む間は検索の帯を出さない)。
// どちらもヘッダー (z-20) の下から始める (§4-5)。
// --note-view-h … ノートが見えている高さ。画像の表示モード「全体」(docs/106)
// が画像の高さの上限に使う。**器の高さと同じ式を書く** — ずれると全体のつもりで
// ペインからはみ出す (globals.css の :root が単独ページの既定を持つ)
export const PANE_BOX_CLASS: Record<NotePaneLayout, string> = {
  pane: "top-auto bottom-[var(--bottom-bar-h)] z-0 h-[var(--preview-pane-h)] [--note-view-h:var(--preview-pane-h)]",
  fullscreen:
    "top-[var(--header-h)] bottom-0 z-10 [--note-view-h:calc(100dvh-var(--header-h))]",
};
