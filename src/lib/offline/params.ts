// /offline の画面状態と URL の対応 (docs/65-オフライン対応計画.md §3-4)。
//
// オフラインの画面は**ルートを 1 つしか持たない**。ノートを開くのも検索も
// /offline の query で表す:
//
//   /offline               … 一覧 (全件)
//   /offline?q=#bjt        … 検索
//   /offline?item=4518     … ノート 1 件
//
// ルートを分けない (例: /offline/item/4518 にしない) のは、Service Worker が
// 殻として保存できる HTML を 1 つに保つため。App Router の画面遷移は RSC
// ペイロードを取りに行くので、圏外では**どのみち別ルートへは進めない**。
// 1 ページの中で query だけを書き換えるなら通信は起きない。
//
// **パラメータ名は sw.js と対**。取れなかった /item/:itemNo を ?item= へ、
// /?q=… を ?q= へ翻訳して送ってくる (sw.js の offlineRedirectUrl)。

import { isValidItemNo } from '@/lib/validation'

export const OFFLINE_PATH = '/offline'

export interface OfflineRoute {
  query: string
  // null = 一覧を出す
  itemNo: string | null
}

// location.search (先頭の ? を含んでよい) から画面状態を読む。
//
// URL は誰でも書き換えられる外部入力なので、itemNo は書式を確かめてから使う
// (publicPaths.ts が /item/:itemNo に isValidItemNo を通すのと同じ線引き)。
export function readOfflineRoute(search: string): OfflineRoute {
  const params = new URLSearchParams(search)
  const itemNo = params.get('item') ?? ''
  return {
    query: params.get('q') ?? '',
    itemNo: isValidItemNo(itemNo) ? itemNo : null,
  }
}

// 画面状態を URL にする (history.pushState へ渡す)。
//
// **ノートを開いても検索語を落とさない。** 落とすと、戻ったときに一覧が
// 全件へ戻ってしまい、開くたびに探し直しになる。
export function offlineRouteUrl(route: OfflineRoute): string {
  const params = new URLSearchParams()
  if (route.query !== '') {
    params.set('q', route.query)
  }
  if (route.itemNo !== null) {
    params.set('item', route.itemNo)
  }
  const search = params.toString()
  return search === '' ? OFFLINE_PATH : `${OFFLINE_PATH}?${search}`
}
