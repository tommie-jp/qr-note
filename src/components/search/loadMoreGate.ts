// 検索直後の自動の追加読み込みを、利用者が一覧をスクロールするまで止める
// (docs/118 §2)。AutoLoadMore が使う判定だけを DOM 無しで置く。
//
// 小さい表示の 20 件は、PC でも iPhone でも先読みの距離 (画面 2 つぶん) に
// 届かない。そのため検索のたびに、誰もスクロールしていないのに 40 件・
// 60 件の追加が続き、1 回の検索が 2〜3 回の要求になっていた。追加は 1〜N
// ページを描き直すので後ほど大きく、`コンデンサ` の 1 回で gzip 後 575KB を
// 運んだ (1 ページ目だけなら 57KB)。

// 「スクロールした」と見なす下向きの距離 (px)。慣性やレイアウトの揺れで
// 1〜2px 動いただけでは解禁しない
export const SCROLL_ARM_DISTANCE_PX = 8

// スクロール位置を受け取り、解禁してよいかを返す関数を作る。
//
// **下向きに動いたときだけ解禁する。** 新しい検索で一覧が先頭へ戻される
// ときもスクロールイベントは飛ぶので、「イベントが来たら解禁」では検索の
// たびに解禁されてしまう。見てきた中で一番上の位置を覚え、そこから
// 下へ SCROLL_ARM_DISTANCE_PX 以上進んだら解禁とする
export function createScrollArm(
  initialTop: number,
  distance: number = SCROLL_ARM_DISTANCE_PX,
): (top: number) => boolean {
  let highest = initialTop
  return (top) => {
    if (top < highest) {
      highest = top
      return false
    }
    return top - highest >= distance
  }
}

// 追加読み込みの href から、ページ番号を除いた「どの検索か」の鍵を作る。
// 解禁はこの鍵ごとに覚える — 一度スクロールした検索の 3 ページ目以降は
// 今までどおり先読みし、検索語か並び順が変わったら止め直す
export function searchKeyOf(href: string): string {
  const url = new URL(href, 'http://local')
  url.searchParams.delete('page')
  return `${url.pathname}?${url.searchParams.toString()}`
}

// 一覧がスクロールできる長さか。scrollHeight と clientHeight は端数で
// 1px ずれることがあるので、1px までは「収まっている」とみなす。
//
// **収まっている (スクロールできない) 間は自動で追加してよい。** 画面の高い
// PC では 20 件が器に収まり、スクロールの印を待つと永久に伸びない。
// 埋まってスクロールできる長さになったら、そこからは印を待つ
export function canScroll(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1
}
