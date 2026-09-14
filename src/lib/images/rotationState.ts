// 画像回転ボタンの角度計算 (docs/49-画像回転計画.md §2)。
//
// 「押すたびに CSS で即回す」の累計角 (deg) を、デバウンス後にサーバへ送るべき
// 角度へ畳む純関数。React state / タイマーから切り離してテストできるようにする。

import type { RotateAngle } from './rotateImage'

// 累計表示角 (押すたびに +90) を 0..359 に畳んだ、サーバへ送るべき角度。
// 0 (回っていない / 一周して戻った) なら送らない = null。
// displayAngle は +90 の積み上げしか来ないので、正規化すると必ず
// {0,90,180,270} のいずれかになる。
export function pendingRotation(displayAngle: number): RotateAngle | null {
  const normalized = ((displayAngle % 360) + 360) % 360
  return normalized === 0 ? null : (normalized as RotateAngle)
}
