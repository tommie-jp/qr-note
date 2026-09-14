// 長押しの判定 (docs/62-下部バー長押し計画.md §2)。
//
// タイマーと DOM の後始末は useLongPress (components) が持ち、ここには
// 「どれだけ待つか」「どこまで動いたら取り消すか」だけを置く。閾値の判断を
// React から切り離しておくと、jsdom を持たないこの土台でも検査できる
// (vitest.config.ts の environment: 'node')。

// 押し始めてからメニューを出すまで。iOS の触覚メニューが約 0.5 秒で、
// これより短いと「触れただけ」で出てしまい、逆に長いと指が待ちくたびれる
export const LONG_PRESS_MS = 500;

// この距離を超えて指が動いたら、長押しではなくスクロールとみなして取り消す。
// 押している間に指はどうしても微動するので 0 にはできない
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export interface PressPoint {
  x: number;
  y: number;
}

// 押し始めの点から許容範囲を出たか。上下左右のどれに動いても同じ扱いに
// したいので、軸ごとの差ではなく直線距離で測る
export function hasLeftPressArea(
  start: PressPoint,
  current: PressPoint,
  tolerance = LONG_PRESS_MOVE_TOLERANCE_PX,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > tolerance;
}
