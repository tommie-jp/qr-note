// 行アクションのメニューを画面のどこへ出すか (docs/66-行アクション計画.md §5-3)。
//
// 位置決めだけを純関数にして、この土台 (vitest.config.ts の
// environment: 'node') でも検査できるようにする。DOM も React も触らない —
// 実寸を測るのは RowActionMenu の役目で、ここは測った数だけを受け取る
// (lib/swipeRow.ts・lib/longPress.ts と同じ分担)。

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

// 押した点を起点に、メニュー全体が画面へ収まる位置を返す。
//
// 収まらない向きは諦めて反対側へ回す。**負の座標は返さない** — 上端や左端が
// 画面の外へ出ると、そこにある項目が押せないまま残る (スクロールもできない)。
export function placeRowActionMenu(
  point: MenuPoint,
  menu: MenuSize,
  viewport: MenuSize,
  margin = ROW_ACTION_MENU_MARGIN,
): MenuPosition {
  // 横: 押した指の中心に揃える。メニューのほうが画面より広ければ左端に寄せる
  // (clamp の min > max を避ける。逆順に渡すと max 側が勝って右へ飛ぶ)
  const maxLeft = viewport.width - menu.width - margin;
  const left =
    maxLeft < margin ? margin : clamp(point.x - menu.width / 2, margin, maxLeft);

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
  // どちらにも入らない (横持ちの浅い画面など)。押した位置は諦め、
  // 全部が見える場所へ寄せる
  return {
    left,
    top: maxTop < margin ? margin : clamp(point.y - menu.height / 2, margin, maxTop),
  };
}
