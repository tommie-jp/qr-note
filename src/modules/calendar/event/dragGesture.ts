// 日の一覧の ︙ の「押した」と「ドラッグした」の見分け (docs/126 §1-38)。純関数。
//
// ︙ は押すとメニュー、ドラッグで並べ替え・別の日へ移す。指はタップでも少し動くので、
// この距離を超えて動くまではドラッグと見ない
export const DRAG_START_PX = 6

// ドラッグを終えた直後に届く click を捨てる間。離した所が ︙ の上だと、ブラウザは
// pointerup の後に click も送る。それでメニューが開かないようにする
export const CLICK_AFTER_DRAG_MS = 400

export interface Point {
  x: number
  y: number
}

export function hasDragStarted(start: Point, now: Point): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_START_PX
}

// dragEndedAt … 最後にドラッグを終えた時刻 (ms)。無ければ null
export function isClickAfterDrag(dragEndedAt: number | null, now: number): boolean {
  return dragEndedAt !== null && now - dragEndedAt < CLICK_AFTER_DRAG_MS
}
