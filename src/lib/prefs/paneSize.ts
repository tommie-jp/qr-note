// 検索 3 ペインの境界のドラッグ (docs/86 §4-2)。
//
// 動かす対象は globals.css の CSS 変数 2 つだけ。ペイン自身の寸法も、
// 一覧の底上げ padding も、カード一覧の広幅補正も、もとから同じ変数を
// 見ているので (docs/86 §4)、ここで変数を書き換えれば全部が追随する。
//
// 保存は localStorage、初回描画前の反映は layout の <head> (PreHydrationScripts.tsx) に置く
// インラインスクリプト — テキストサイズ (docs/61) と同じ作り。サーバは
// 寸法を知らないので、この 2 つだけで完結する。

import { makeCssVarInitScript } from "./cssVarInitScript";

// 動かせる境界。**単位・既定・上下限・刻みは必ずこの表 1 つで持つ**
// (NotePreviewFrame の FRAME と同じ判断)。CSS 変数の綴りもここが正本で、
// 先回りスクリプトもこの表から組み立てる — 数値を書き写した瞬間に、
// 片方だけ直した日の「読み込み直後だけ別の寸法」が生まれる。
//
// 単位の選び方:
//   フォルダー幅 … rem。テキストサイズ (docs/61) を上げると中の行も伸びる
//     ので、幅も一緒に伸びないと文字が詰まる。既定の 14rem と同じ土俵。
//   プレビュー高 … dvh。ウィンドウの高さが変わっても「画面の何割」が保たれる。
//     px で持つと、小さい画面に持ち込んだとき一覧が潰れる。
export const PANE_SIZES = {
  folder: {
    storageKey: "pane-folder-w",
    cssVar: "--folder-pane-w",
    unit: "rem",
    default: 14,
    // 下限は隠す目安 (2 文字) のすぐ上。上限は実質「画面の幅」 — ドラッグでは
    // タブが画面の右端に半分残るまで広げられる (docs/86 §4-21。livePaneSizeLimit)
    min: 3,
    max: 200,
    step: 1,
    label: "フォルダーの幅",
    orientation: "vertical",
  },
  preview: {
    storageKey: "pane-preview-h",
    cssVar: "--preview-pane-h",
    unit: "dvh",
    default: 45,
    // 下限・上限は隠す目安 (2 行) の少し内側 (docs/86 §4-21)
    min: 10,
    max: 95,
    step: 5,
    label: "プレビューの高さ",
    orientation: "horizontal",
  },
} as const;

export type PaneKind = keyof typeof PANE_SIZES;
export type PaneSpec = (typeof PANE_SIZES)[PaneKind];

// 下部操作バーの高さ (44px スロット + 余白 4px + 枠 1px)。CSS 側の
// --bottom-bar-h と対で、プレビューの下端と境界の位置を決める。
// **実行時は CSS 変数を読む** (readBottomBarPx) ので、この定数は
// 変数が読めない環境の受け皿でしかない
export const BOTTOM_BAR_FALLBACK_PX = 49;

// 保存された値・外から来た値を使える寸法に畳む。
//
// **範囲外は既定へ戻さず、いちばん近い端へ寄せる** — 「上限を超えていたら
// 既定に戻す」より「上限で開く」ほうが利用者の意図に近い
// (normalizeNoteFontScale が最寄りの段へ寄せるのと同じ判断)。
// 数として読めないものだけ既定に落とす。
export function clampPaneSize(kind: PaneKind, raw: unknown): number {
  const spec = PANE_SIZES[kind];
  const value =
    typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(value)) {
    return spec.default;
  }
  return Math.min(spec.max, Math.max(spec.min, Math.round(value * 10) / 10));
}

// CSS に書ける文字列 ("14rem" / "45dvh")
export function paneSizeValue(kind: PaneKind, size: number): string {
  return `${size}${PANE_SIZES[kind].unit}`;
}

// ポインタの位置から寸法を出す。**この計算が CSS と対になっている**
// のが要点 (docs/86 §4-2):
//
//   folder  … ペインは画面の左端から始まるので、幅 = ポインタの x。
//             rem に直すのは、保存する単位が rem だから (上の表)。
//   preview … ペインは下部バーのぶん上で終わるので、
//             高さ = 画面の高さ - バー - ポインタの y。dvh に直す。
export interface PointerGeometry {
  clientX: number;
  clientY: number;
  rootFontSizePx: number;
  viewportHeightPx: number;
  bottomBarPx: number;
}

export function paneSizeFromPointer(kind: PaneKind, geometry: PointerGeometry): number {
  return clampPaneSize(kind, rawPaneSizeFromPointer(kind, geometry));
}

// 上下限で止める前の寸法。引き切ったか (paneCollapse) の判定に使う
export function rawPaneSizeFromPointer(kind: PaneKind, geometry: PointerGeometry): number {
  if (kind === "folder") {
    // 0 除算だけは避ける (root の font-size が読めない環境)
    const rootPx = geometry.rootFontSizePx || 16;
    return geometry.clientX / rootPx;
  }
  const viewport = geometry.viewportHeightPx || 1;
  const heightPx = viewport - geometry.bottomBarPx - geometry.clientY;
  return (heightPx / viewport) * 100;
}

// ドラッグ中に寸法を動かせる上限 (docs/86 §4-21)。タブが画面の外へ出ないよう、
// フォルダーは画面の幅まで、下のペインはヘッダーの下までに止める。下限は 0
// (タブが画面の端に半分残る)
export function livePaneSizeLimit(
  kind: PaneKind,
  viewport: { widthPx: number; heightPx: number; rootFontSizePx: number; bottomBarPx: number; headerPx: number },
): number {
  if (kind === "folder") {
    return viewport.widthPx / (viewport.rootFontSizePx || 16);
  }
  const height = viewport.heightPx || 1;
  return Math.max(0, ((height - viewport.bottomBarPx - viewport.headerPx) / height) * 100);
}

// 境界を引き切って離したら、狭くなった側のペインを隠して構成を減らす (docs/86 §4-19)。
// 見ているのは寸法の上下限ではなく、**ポインタの位置で残る中身の量**:
//
//   フォルダーの境界 (3 ペイン) … 幅が 2 文字 (2rem) 以下 → フォルダーを隠して 2 ペイン
//   一覧とノートの境界 (2・3 ペイン) … 下のペインが 2 行以下 → 下を隠して 1 ペイン、
//     上の一覧が 2 行以下 → 一覧を隠して 1 ペイン (3 ペインはフォルダーも一緒に隠れる)
//
// 1 行は 1.5rem (本文の行の高さ)。寸法そのものは上下限で止まるので、引き切って
// いる間もペインは端の大きさのまま (タブの色で「離すと隠す」を見せる)
export const COLLAPSE_FOLDER_CHARS = 2;
export const COLLAPSE_LINES = 2;
export const LINE_REM = 1.5;

export type PaneCollapse =
  | { hide: "folder"; mode: "2" }
  | { hide: "preview" | "results"; mode: "1" };

export function paneCollapse(
  kind: PaneKind,
  geometry: PointerGeometry & { resultsTopPx: number },
  mode: string,
): PaneCollapse | null {
  const rootPx = geometry.rootFontSizePx || 16;
  if (kind === "folder") {
    return mode === "3" && geometry.clientX <= COLLAPSE_FOLDER_CHARS * rootPx
      ? { hide: "folder", mode: "2" }
      : null;
  }
  if (mode !== "2" && mode !== "3") {
    return null;
  }
  const limit = COLLAPSE_LINES * LINE_REM * rootPx;
  const bottomPx = geometry.viewportHeightPx - geometry.bottomBarPx - geometry.clientY;
  if (bottomPx <= limit) {
    return { hide: "preview", mode: "1" };
  }
  if (geometry.clientY - geometry.resultsTopPx <= limit) {
    return { hide: "results", mode: "1" };
  }
  return null;
}

// タブのダブルクリックで隠すペイン。フォルダーの境界はフォルダー、一覧とノートの
// 境界は下のペイン (どちらも引き切ったときと同じ行き先)
export function paneHideByDoubleClick(kind: PaneKind, mode: string): PaneCollapse | null {
  if (kind === "folder") {
    return mode === "3" ? { hide: "folder", mode: "2" } : null;
  }
  return mode === "2" || mode === "3" ? { hide: "preview", mode: "1" } : null;
}

// 初回描画の前に走らせるスクリプト (chrome/PreHydrationScripts.tsx が layout の
// <head> へ inline で置く)。
//
// useEffect で当てると、サーバが描いた既定の寸法でひととおり組まれた後に
// ペインだけ動く。境界を動かした人は毎回その跳ねを見ることになるので、
// HTML の解析中に同期で当てる (テキストサイズと同じ手)。
//
// **表 (PANE_SIZES) をそのまま埋め込む。** 数値を書き写さないので、
// 上下限を直せばスクリプトも一緒に直る (書き写すと、読み込み直後だけ
// 古い上限で clamp される端末が生まれる)。丸めと端への寄せ方は
// clampPaneSize と同じ断片を prefs/cssVarInitScript.ts が組む。
export const PANE_SIZE_INIT_SCRIPT = makeCssVarInitScript({
  normalize: "clamp",
  targets: Object.values(PANE_SIZES),
});
