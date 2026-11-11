// 日の予定を浮かせて出す位置 (docs/126 §1-6)。DOM に触らない純関数。
//
// 選んだマスの右に出す。右がはみ出すなら左。どちらにも入らない狭い画面では
// 画面の中に収まる所まで寄せる (マスに重なってよい)。縦はマスの上端に揃え、
// 下がはみ出すなら上へずらす。画面より背が高ければ画面の高さに縮め、中を送る
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Placement {
  left: number
  top: number
  // 画面に収まる高さの上限 (中身がこれより高ければ中で送る)
  maxHeight: number
  side: 'right' | 'left' | 'over'
}

// マスとの間 / 画面の端との間 (px)
export const POPOVER_GAP = 4
export const VIEWPORT_MARGIN = 8

export function placePopover(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const maxRight = viewport.width - VIEWPORT_MARGIN
  let left: number
  let side: Placement['side']
  if (anchor.right + POPOVER_GAP + size.width <= maxRight) {
    left = anchor.right + POPOVER_GAP
    side = 'right'
  } else if (anchor.left - POPOVER_GAP - size.width >= VIEWPORT_MARGIN) {
    left = anchor.left - POPOVER_GAP - size.width
    side = 'left'
  } else {
    left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxRight - size.width))
    side = 'over'
  }
  const maxHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2)
  const height = Math.min(size.height, maxHeight)
  const top = Math.max(VIEWPORT_MARGIN, Math.min(anchor.top, viewport.height - VIEWPORT_MARGIN - height))
  return { left, top, maxHeight, side }
}

// 予定のフォームを、押した行の上か下に出す位置 (docs/126 §1-6)。
// 行はペインの幅いっぱいなので横には並べない。左は行に揃えて画面に収め、
// 縦は下に入れば下、入らなければ上、どちらも入らなければ広いほうに寄せて縮める
export function placeAround(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const maxRight = viewport.width - VIEWPORT_MARGIN
  const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxRight - size.width))
  const below = viewport.height - VIEWPORT_MARGIN - (anchor.bottom + POPOVER_GAP)
  const above = anchor.top - POPOVER_GAP - VIEWPORT_MARGIN
  if (size.height <= below) {
    return { left, top: anchor.bottom + POPOVER_GAP, maxHeight: below, side: 'over' }
  }
  if (size.height <= above) {
    return { left, top: anchor.top - POPOVER_GAP - size.height, maxHeight: above, side: 'over' }
  }
  if (below >= above) {
    return { left, top: anchor.bottom + POPOVER_GAP, maxHeight: Math.max(0, below), side: 'over' }
  }
  const maxHeight = Math.max(0, above)
  return { left, top: VIEWPORT_MARGIN, maxHeight, side: 'over' }
}

// 見えている範囲 (レイアウトの画面に対する位置と大きさ)。iPhone はソフトキーボードが
// 出てもレイアウトの画面 (innerHeight) を縮めず、見えている範囲 (visualViewport) だけを
// 縮めて送る (docs/126 §1-32)
export interface View {
  left: number
  top: number
  width: number
  height: number
}

// placeAround を見えている範囲の中で行う。fixed の座標はレイアウトの画面に対する
// ものなので、見えている範囲の座標に直して置き、戻す。行がキーボードの下に隠れて
// いても、フォームは見えている範囲の中に収める (はみ出す分は縮めて中を送る)
export function placeAroundInView(
  anchor: Rect,
  size: { width: number; height: number },
  view: View,
): Placement {
  const local = {
    left: anchor.left - view.left,
    right: anchor.right - view.left,
    top: anchor.top - view.top,
    bottom: anchor.bottom - view.top,
  }
  const placed = placeAround(local, size, { width: view.width, height: view.height })
  const maxHeight = Math.max(0, Math.min(placed.maxHeight, view.height - VIEWPORT_MARGIN * 2))
  const height = Math.min(size.height, maxHeight)
  const top = Math.max(VIEWPORT_MARGIN, Math.min(placed.top, view.height - VIEWPORT_MARGIN - height))
  return { ...placed, left: placed.left + view.left, top: top + view.top, maxHeight }
}
