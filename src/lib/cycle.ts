// 「押すたびに次へ、最後まで行ったら先頭へ」の表を配列から作る。
//
// 下部バーのスロットはどれも 1 つのボタンで値を循環させ、長押しメニューにも
// 同じ並びを出す (docs/62-下部バー長押し計画.md §3)。**順の定義を配列 1 本に
// 保つ**ためにここで表へ畳む — 循環の表を手で書くと、選択肢を足したときに
// メニューの上下と短いタップで辿る順が食い違う (押す前に何が起きるか読めなくなる)。
//
// Object.fromEntries は string の表しか返せないため、ここで 1 度だけ
// Record<T, T> と名乗る (sortDirection.ts の bySort と同じ事情)。
export function cycleOf<T extends string>(values: readonly T[]): Record<T, T> {
  return Object.fromEntries(
    values.map((value, index) => [value, values[(index + 1) % values.length]]),
  ) as Record<T, T>
}
