// 並び順の呼び名 (下部バーのスロットと長押しメニュー)。
//
// 検索一覧とゴミ箱の 2 つのバーが使うので、ここ 1 か所に置く。片方にだけ
// 手を入れて呼び名がずれると、同じ `?sort=accessed` が画面によって違う名前で
// 出ることになる。
//
// 表は 5 種別ぶん (ゴミ箱だけの「削除順」を含む)。SortBase は TrashSortBase の
// 部分集合なので、検索側もこの表をそのまま引ける。

import type { TrashSortBase } from './validation'

export const SORT_BASE_LABEL: Record<TrashSortBase, string> = {
  deleted: '削除順',
  updated: '更新順',
  accessed: 'アクセス順',
  itemNo: '番号順',
  title: 'タイトル順',
}

// 方向の呼び名は [既定の向き, 逆順] の順 (docs/64-並び順逆順計画.md §4)。
// 種別で言い方が変わる — 日時を「昇順」と読んでも新旧のどちらが上か判らないし、
// 番号に「新しい」は無い。名前で語れないタイトル順にだけ昇順・降順を使う。
export const SORT_DIRECTION_LABEL: Record<
  TrashSortBase,
  readonly [string, string]
> = {
  deleted: ['新しい順', '古い順'],
  updated: ['新しい順', '古い順'],
  accessed: ['新しい順', '古い順'],
  itemNo: ['小さい順', '大きい順'],
  title: ['昇順', '降順'],
}
