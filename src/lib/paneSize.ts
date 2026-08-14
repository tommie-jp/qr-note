// 検索 3 ペインの境界のドラッグ (docs/86 §4-2)。
//
// 動かす対象は globals.css の CSS 変数 2 つだけ。ペイン自身の寸法も、
// 一覧の底上げ padding も、カード一覧の広幅補正も、もとから同じ変数を
// 見ているので (docs/86 §4)、ここで変数を書き換えれば全部が追随する。
//
// 保存は localStorage、初回描画前の反映は layout.tsx の <head> に置く
// インラインスクリプト — テキストサイズ (docs/61) と同じ作り。サーバは
// 寸法を知らないので、この 2 つだけで完結する。

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
    // 下限は「#タグ + 件数」が読める幅、上限は一覧が主役でいられる幅
    min: 9,
    max: 28,
    step: 1,
    label: "フォルダーの幅",
    orientation: "vertical",
  },
  preview: {
    storageKey: "pane-preview-h",
    cssVar: "--preview-pane-h",
    unit: "dvh",
    default: 45,
    // 下限は見出し行 + 数行、上限は一覧が数行残る高さ
    min: 20,
    max: 80,
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
export function paneSizeFromPointer(
  kind: PaneKind,
  geometry: {
    clientX: number;
    clientY: number;
    rootFontSizePx: number;
    viewportHeightPx: number;
    bottomBarPx: number;
  },
): number {
  if (kind === "folder") {
    // 0 除算だけは避ける (root の font-size が読めない環境)
    const rootPx = geometry.rootFontSizePx || 16;
    return clampPaneSize(kind, geometry.clientX / rootPx);
  }
  const viewport = geometry.viewportHeightPx || 1;
  const heightPx = viewport - geometry.bottomBarPx - geometry.clientY;
  return clampPaneSize(kind, (heightPx / viewport) * 100);
}

// 初回描画の前に走らせるスクリプト (layout.tsx が <head> へ inline で置く)。
//
// useEffect で当てると、サーバが描いた既定の寸法でひととおり組まれた後に
// ペインだけ動く。境界を動かした人は毎回その跳ねを見ることになるので、
// HTML の解析中に同期で当てる (テキストサイズと同じ手)。
//
// **表 (PANE_SIZES) をそのまま埋め込む。** 数値を書き写さないので、
// 上下限を直せばスクリプトも一緒に直る (書き写すと、読み込み直後だけ
// 古い上限で clamp される端末が生まれる)。
export const PANE_SIZE_INIT_SCRIPT = `(function(){try{var P=${JSON.stringify(
  Object.values(PANE_SIZES).map((s) => [
    s.storageKey,
    s.cssVar,
    s.unit,
    s.min,
    s.max,
  ]),
)};for(var i=0;i<P.length;i++){var p=P[i],r=localStorage.getItem(p[0]);if(r===null)continue;var n=parseFloat(r);if(!isFinite(n))continue;n=Math.round(n*10)/10;if(n<p[3])n=p[3];if(n>p[4])n=p[4];document.documentElement.style.setProperty(p[1],n+p[2])}}catch(e){}})()`;
