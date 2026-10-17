// 行アクションのメニューを画面のどこへ出すか (docs/66-行アクション計画.md §5-3)。
//
// 位置決めだけを純関数にして、この土台 (vitest.config.ts の
// environment: 'node') でも検査できるようにする。DOM も React も触らない —
// 実寸を測るのは RowActionMenu の役目で、ここは測った数だけを受け取る
// (lib/gesture/swipeRow.ts・lib/gesture/longPress.ts と同じ分担)。

// 画面の縁とメニューの間に必ず残す余白 (px)。0 にすると角の丸みが切れて、
// メニューが画面の外へ続いているように見える
export const ROW_ACTION_MENU_MARGIN = 8;

export interface MenuSize {
  width: number;
  height: number;
}

export interface MenuPoint {
  x: number;
  y: number;
}

export interface MenuPosition {
  left: number;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 1 つの軸で、メニューを画面へ収める位置。縦横で同じ規則を使う。
//
// メニューのほうが画面より大きければ始端 (左・上) に寄せる。clamp の
// min > max を避けるため — 逆順に渡すと max 側が勝って負の座標へ飛び、
// 始端の項目が押せないまま残る (スクロールもできない)
function fitAxis(preferred: number, size: number, viewportSize: number, margin: number) {
  const max = viewportSize - size - margin;
  return max < margin ? margin : clamp(preferred, margin, max);
}

// 押した点を起点に、メニュー全体が画面へ収まる位置を返す (長押しから開いたとき)。
//
// 収まらない向きは諦めて反対側へ回す。
export function placeRowActionMenu(
  point: MenuPoint,
  menu: MenuSize,
  viewport: MenuSize,
  margin = ROW_ACTION_MENU_MARGIN,
): MenuPosition {
  // 横: 押した指の中心に揃える
  const left = fitAxis(point.x - menu.width / 2, menu.width, viewport.width, margin);

  // 縦: まず指の上へ。iOS の触覚メニューと同じで、押している指がメニューを
  // 隠さない。上に入らなければ下へ回す
  const maxTop = viewport.height - menu.height - margin;
  const above = point.y - menu.height - margin;
  if (above >= margin) {
    return { left, top: above };
  }
  const below = point.y + margin;
  if (below <= maxTop) {
    return { left, top: below };
  }
  // どちらにも入らない。押した位置は諦め、全部が見える場所へ寄せる
  return {
    left,
    top: fitAxis(point.y - menu.height / 2, menu.height, viewport.height, margin),
  };
}

// 画面上の矩形 (getBoundingClientRect の 4 辺)
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// ⋮ ボタンを起点に置く (docs/107-行メニュー計画.md §4)。
//
// 指の点と違って起点が見えたまま残るので、上へ逃がす理由が無い。
// PC アプリの通例どおり**ボタンの真下に、右端を揃えて**出す (⋮ は行の
// 右端にあるので、左へ開けば画面に収まる)。下に入らなければ上へ回す。
// ボタンとメニューの間は空けない — 離すと、どのボタンから出たのかが
// 読み取りにくくなる
export function placeRowActionMenuAtAnchor(
  anchor: AnchorRect,
  menu: MenuSize,
  viewport: MenuSize,
  margin = ROW_ACTION_MENU_MARGIN,
): MenuPosition {
  const left = fitAxis(anchor.right - menu.width, menu.width, viewport.width, margin);

  const maxTop = viewport.height - menu.height - margin;
  if (anchor.bottom <= maxTop) {
    return { left, top: anchor.bottom };
  }
  const above = anchor.top - menu.height;
  if (above >= margin) {
    return { left, top: above };
  }
  return {
    left,
    top: fitAxis(anchor.bottom, menu.height, viewport.height, margin),
  };
}

// メニューをどこから開いたか。長押しは指の点、⋮ はボタンの矩形
export type MenuOrigin =
  | { kind: "point"; point: MenuPoint }
  | { kind: "anchor"; rect: AnchorRect };

export function placeRowActionMenuFrom(
  origin: MenuOrigin,
  menu: MenuSize,
  viewport: MenuSize,
): MenuPosition {
  return origin.kind === "point"
    ? placeRowActionMenu(origin.point, menu, viewport)
    : placeRowActionMenuAtAnchor(origin.rect, menu, viewport);
}
