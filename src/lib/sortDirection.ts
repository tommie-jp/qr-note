// 並び順の「種別」と「方向」の出し入れ (docs/64-並び順逆順計画.md)。
//
// Sort は 8 値の文字列だが、UI もラベルも「種別 4 つ × 方向 2 つ」で考える。
// その畳み込みをここに 1 箇所だけ置く。SQL 側 (sortOrder.ts) と cookie 側
// (sortMode.ts) は 8 値をそのまま扱うので、この表を見るのは UI だけ。
//
// **逆順を「もう一度押す」に載せる**のがこの設計の理由 —
// メニューに 8 行並べると、選ぶ前に読む量が倍になる。種別を選ぶ 4 行のまま、
// 選んである行の再タップだけを方向の裏返しに使う (docs/64 §3)。

import { type Sort, type SortBase, SORTS } from './validation'

// 種別 → 逆順の値。基底の 4 値は既定の方向なので、この表が方向の全体像になる
const REVERSED_OF: Record<SortBase, Sort> = {
  updated: 'updatedAsc',
  accessed: 'accessedAsc',
  itemNo: 'itemNoDesc',
  title: 'titleDesc',
}

const BASE_OF: Record<Sort, SortBase> = {
  updated: 'updated',
  accessed: 'accessed',
  itemNo: 'itemNo',
  title: 'title',
  updatedAsc: 'updated',
  accessedAsc: 'accessed',
  itemNoDesc: 'itemNo',
  titleDesc: 'title',
}

// 方向を落として種別だけを取り出す。メニューのチェック (どの行が今の並びか)
// と、短いタップの循環 (種別だけを回す) がこれを見る
export function baseOf(sort: Sort): SortBase {
  return BASE_OF[sort]
}

export function isReversed(sort: Sort): boolean {
  return BASE_OF[sort] !== sort
}

// 種別を保ったまま方向だけを裏返す。2 回で元に戻るので、選んである行を
// 押し続けても迷子にならない
export function reverseOf(sort: Sort): Sort {
  const base = BASE_OF[sort]
  return sort === base ? REVERSED_OF[base] : base
}

// その並びが降順か。下部バーのアイコン (↑ / ↓) の向きを決める。
//
// **既定の向きは種別で違う** — 日時は「新しい順」つまり降順が既定で、
// 番号とタイトルは昇順が既定。逆順かどうかだけでは矢印は描けない。
// SQL 側 (sortOrder.ts) の ORDER BY と必ず一致させる (sortDirection.test.ts
// が両方を突き合わせている)
const DESCENDING_BY_DEFAULT: Record<SortBase, boolean> = {
  updated: true,
  accessed: true,
  itemNo: false,
  title: false,
}

export function isDescending(sort: Sort): boolean {
  return DESCENDING_BY_DEFAULT[BASE_OF[sort]] !== isReversed(sort)
}

// Sort 8 値ぶんの表を組み立てる。CycleSlot は「妥当な値をすべて並べた表」で
// 送信中の値を畳む (labelOf に無い値は current に倒す) ので、種別ごとの
// 値をそのまま渡すのではなく 8 値に展開しておく必要がある。
//
// Object.fromEntries は string の表しか返せないため、ここで 1 度だけ
// Record<Sort, V> と名乗る。元が SORTS なので鍵は 8 値ちょうど
// (sortDirection.test.ts が鍵の集合を照合している)
export function bySort<V>(of: (sort: Sort) => V): Record<Sort, V> {
  return Object.fromEntries(SORTS.map((sort) => [sort, of(sort)])) as Record<
    Sort,
    V
  >
}
