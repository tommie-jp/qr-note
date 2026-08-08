// /offline の URL を React から購読する (docs/65-オフライン対応計画.md §4)。
//
// **なぜ state ではなく外部ストアなのか。** URL はこの画面にとって外部の
// 状態で、変わる経路が 2 つある — 自分で書き換える (打鍵・ノートを開く) のと、
// ブラウザの戻る/進む (popstate) である。React の state に写し取ろうとすると
// 「マウント後に URL を読んで setState する」形になり、描画の後にもう一度
// 描画が走る (React 19 の set-state-in-effect が禁じている形)。
//
// useSyncExternalStore なら、初回の読み取り・購読・サーバ描画時の既定値を
// 1 つの仕組みで扱える。サーバ側は常に空 ('') を返す — Service Worker が
// 保存する殻は素の /offline で描いた 1 枚きりなので、それが正しい既定値になる。
//
// **history API は popstate を発火しない** (自分で書き換えたときは通知が
// 来ない)。だから書き換える側が notifyLocationChanged を呼ぶ約束にする。

import { parseSort, type Sort } from '@/lib/validation'

const listeners = new Set<() => void>()

export function subscribeLocation(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

// pushState / replaceState の直後に呼ぶ。呼び忘れると画面が URL に付いてこない
export function notifyLocationChanged(): void {
  for (const listener of listeners) {
    listener()
  }
}

// getSnapshot。**文字列を返す**のが要点 — オブジェクトを組み立てて返すと
// 参照が毎回変わり、useSyncExternalStore が「変わった」と見て描画し続ける
export function locationSearch(): string {
  return window.location.search
}

// getServerSnapshot。殻は素の /offline なので、常に query 無しで描く
export function serverLocationSearch(): string {
  return ''
}

// 一覧の並び順 (docs/11-アプリ的UIUX計画.md §3 の cookie)。
//
// オンラインの一覧で選んだ並びをそのまま使い、この画面には並び替えの UI を
// 置かない — 圏外で要るのは「探して読む」であって、並びの調整ではない。
// 値は利用者が書き換えられる外部入力なので parseSort で畳む (sortMode.ts と同じ)。
export function readSortCookie(): Sort {
  const match = /(?:^|;\s*)sort=([^;]*)/.exec(document.cookie)
  return parseSort(match ? decodeURIComponent(match[1]) : undefined)
}

// cookie は画面を開いている間に変わらない (変えるのは別ページの操作で、
// そこへ移れば描画ごとやり直しになる)。購読しないので解除も何もしない
export function subscribeNever(): () => void {
  return () => {}
}

export function serverSortCookie(): Sort {
  return 'updated'
}
