// 並び順の「種別」と「方向」の出し入れ (docs/64-並び順逆順計画.md)。
//
// Sort は 8 値の文字列だが、UI もラベルも「種別 4 つ × 方向 2 つ」で考える。
// その畳み込みをここに 1 箇所だけ置く。SQL 側 (sortOrder.ts) と cookie 側
// (sortMode.ts) は 8 値をそのまま扱うので、この表を見るのは UI だけ。
//
// **逆順を「もう一度押す」に載せる**のがこの設計の理由 —
// メニューに 8 行並べると、選ぶ前に読む量が倍になる。種別を選ぶ 4 行のまま、
// 選んである行の再タップだけを方向の裏返しに使う (docs/64 §3)。

import {
  type Sort,
  type SortBase,
  SORTS,
  type TrashSort,
  type TrashSortBase,
  TRASH_SORTS,
} from './validation'

// メニューに並べる種別の順。**短いタップの循環もこの並びから作る**
// (cycle.ts の cycleOf) ので、メニューの上下と辿る順が食い違わない。
// よく使う 2 つ (更新順・アクセス順) を隣どうしに置いたまま、後から足した
// タイトル順を末尾に付けてある
export const SORT_BASES: readonly SortBase[] = [
  'updated',
  'accessed',
  'itemNo',
  'title',
]

// ゴミ箱は先頭が削除順 (あちらの既定。docs/67-ゴミ箱表示形式計画.md §2)
export const TRASH_SORT_BASES: readonly TrashSortBase[] = [
  'deleted',
  ...SORT_BASES,
]

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

// --- ゴミ箱 (docs/67-ゴミ箱表示形式計画.md §2) ---
//
// ゴミ箱の並びは Sort の 4 種別に「削除順」を足しただけなので、上の 3 つの表を
// 5 種別ぶんに書き換えることはしない。**書き換えると Record<SortBase, …> を
// 受けている検索側のバーが 5 行目 (削除順) を要求され始める** — 検索一覧では
// 意味を持たない並びなのに、あちらの表にも埋めなければならなくなる。
// 増えた 1 対だけをここで受けて、残りは上の関数へそのまま委ねる。

function isDeletedSort(sort: TrashSort): sort is 'deleted' | 'deletedAsc' {
  return sort === 'deleted' || sort === 'deletedAsc'
}

export function trashBaseOf(sort: TrashSort): TrashSortBase {
  return isDeletedSort(sort) ? 'deleted' : baseOf(sort)
}

export function trashReverseOf(sort: TrashSort): TrashSort {
  if (isDeletedSort(sort)) {
    return sort === 'deleted' ? 'deletedAsc' : 'deleted'
  }
  return reverseOf(sort)
}

// 削除順の既定は降順 (新しく消した物が上)。更新順・アクセス順と同じ扱い
export function trashIsDescending(sort: TrashSort): boolean {
  return isDeletedSort(sort) ? sort === 'deleted' : isDescending(sort)
}

export function byTrashSort<V>(of: (sort: TrashSort) => V): Record<TrashSort, V> {
  return Object.fromEntries(
    TRASH_SORTS.map((sort) => [sort, of(sort)]),
  ) as Record<TrashSort, V>
}

// --- 下部バーへ渡す一式 (components/SortSlot.tsx) ---
//
// 検索一覧とゴミ箱で違うのは「種別が 4 つか 5 つか」だけで、メニューの組み立て
// (現在行の再タップだけ方向を裏返す) も循環も同じ。**違いをこの 2 つの束に
// 閉じ込めて、画面側には同じ部品を置く**。
export interface SortSpec<S extends string, B extends S> {
  // メニューに並べる種別。短いタップの循環もこの並びから作る
  bases: readonly B[]
  baseOf: (sort: S) => B
  reverseOf: (sort: S) => S
  isDescending: (sort: S) => boolean
  // 妥当な値をすべて並べた表を組む (CycleSlot が送信中の値を畳む鍵)
  by: <V>(of: (sort: S) => V) => Record<S, V>
}

export const SEARCH_SORT_SPEC: SortSpec<Sort, SortBase> = {
  bases: SORT_BASES,
  baseOf,
  reverseOf,
  isDescending,
  by: bySort,
}

export const TRASH_SORT_SPEC: SortSpec<TrashSort, TrashSortBase> = {
  bases: TRASH_SORT_BASES,
  baseOf: trashBaseOf,
  reverseOf: trashReverseOf,
  isDescending: trashIsDescending,
  by: byTrashSort,
}
