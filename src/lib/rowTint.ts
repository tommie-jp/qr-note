// 検索結果で「いま開いている行」の地色 (docs/88-選択行の色計画.md)。
//
// 3 ペインでは一覧とノートが同時に見えるので、どの行を開いているかの目印が
// 常時出ている (docs/86 §4)。目印そのものは要るが、**どの色が見やすいかは
// 人と環境で違う** — 明るい所では青 50 が白に沈み、逆に濃い色だと本文より
// 目立ちすぎる。だから色を選べるようにする。
//
// **このファイルはクライアントからも import される。** prisma や next/headers
// を持ち込まないこと (読み書きは rowTintStore.ts。thumbnail.ts で sharp を
// クライアントへ漏らしたのと同じ罠)。
//
// 効かせ方は CSS 変数 3 つ。文字サイズ (noteFontScale.ts) と同じ流儀で
// html に立て、globals.css が既定値を持つ。クラス名を色ごとに用意しない
// のが要点 — Tailwind はソース中の完全なクラス名しか拾わないので
// `bg-${color}-50` は生成されず、6 色ぶんを全部書き並べる羽目になる。

export type RowTintId =
  | "blue"
  | "green"
  | "amber"
  | "rose"
  | "violet"
  | "gray";

export interface RowTint {
  id: RowTintId;
  // メニューの読み上げ用の名前 (絵だけでは色覚によって区別が付かない)
  label: string;
  // 行の地色
  bg: string;
  // 押している間の地色 (bg より 1 段濃い)
  active: string;
  // 画像タイルの枠 (地色だけでは 1 枚の画像の中に埋もれる)
  border: string;
}

// 値は Tailwind の 50 / 100 / 400。**リテラルで持つ**のは、Tailwind v4 の
// テーマ変数 (--color-blue-50) が使われた色しか出力されない可能性があるため。
// ここは Tailwind のクラス経由ではなく生の CSS 変数へ入れるので、色が
// 出力から落ちると既定色が消えて透明になる。
//
// 灰だけ 100 / 200 / 400 を使う。50 は選択していない行の hover (bg-gray-50) と
// 同じ色で、「触れているだけの行」と見分けが付かなくなる。
export const ROW_TINTS: readonly RowTint[] = [
  { id: "blue", label: "青", bg: "#eff6ff", active: "#dbeafe", border: "#60a5fa" },
  { id: "green", label: "緑", bg: "#f0fdf4", active: "#dcfce7", border: "#4ade80" },
  { id: "amber", label: "黄", bg: "#fffbeb", active: "#fef3c7", border: "#fbbf24" },
  { id: "rose", label: "桃", bg: "#fff1f2", active: "#ffe4e6", border: "#fb7185" },
  { id: "violet", label: "紫", bg: "#f5f3ff", active: "#ede9fe", border: "#a78bfa" },
  { id: "gray", label: "灰", bg: "#f3f4f6", active: "#e5e7eb", border: "#9ca3af" },
] as const;

// 選ばれていないときの色。これまでの見た目 (bg-blue-50) をそのまま既定にする
export const DEFAULT_ROW_TINT_ID: RowTintId = "blue";

// user_settings の key。値は RowTintId の文字列そのもの
export const ROW_TINT_SETTING_KEY = "row-tint";

export const ROW_TINT_BG_VAR = "--row-tint-bg";
export const ROW_TINT_ACTIVE_VAR = "--row-tint-active";
export const ROW_TINT_BORDER_VAR = "--row-tint-border";

// 保存された値が既知の色かどうか。**API の入口はこちらを使う** —
// 知らない値を黙って既定へ寄せると、送り手は保存できたと思い込む
export function isRowTintId(value: unknown): value is RowTintId {
  return ROW_TINTS.some((tint) => tint.id === value);
}

// DB や cookie から読んだ値を畳む。知らない値・欠落は既定へ。
// 色は「壊れていたら既定で描く」で困らない (履歴や本文と違い、失われる情報がない)
export function parseRowTintId(value: unknown): RowTintId {
  return isRowTintId(value) ? value : DEFAULT_ROW_TINT_ID;
}

export function rowTintOf(id: RowTintId): RowTint {
  // parseRowTintId を通していれば必ず見つかる。型の外から来た値でも
  // 落ちないよう、見つからなければ既定 (先頭 = blue) を返す
  return ROW_TINTS.find((tint) => tint.id === id) ?? ROW_TINTS[0];
}

// html の style 属性に載せる形 (サーバが描くときに使う)。
// React.CSSProperties は CSS 変数を型で受けないので、呼ぶ側でキャストする
export function rowTintVars(id: RowTintId): Record<string, string> {
  const tint = rowTintOf(id);
  return {
    [ROW_TINT_BG_VAR]: tint.bg,
    [ROW_TINT_ACTIVE_VAR]: tint.active,
    [ROW_TINT_BORDER_VAR]: tint.border,
  };
}

// その場で塗り替える (メニューで色を押したとき)。サーバへの保存を待たずに
// 当てるので、通信が遅くても押した瞬間に一覧の色が変わる。
// 保存に失敗しても戻さない — 見えている色と押した色が食い違うほうが混乱する。
// 食い違いは呼ぶ側 (RowTintMenuItem) が文言で伝える
export function applyRowTint(element: HTMLElement, id: RowTintId): void {
  for (const [name, value] of Object.entries(rowTintVars(id))) {
    element.style.setProperty(name, value);
  }
}
