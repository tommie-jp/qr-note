// オフライン一覧の並べ替え (docs/65-オフライン対応計画.md §3-3)。
//
// sortOrder.ts の ORDER BY 句と**同じ並びを JS で作り直したもの**。片方だけ
// 直すとオンラインとオフラインで一覧の順が食い違うので、必ず対で直すこと。
// 書き写しにならざるを得ないのは、あちらが SQL の文字列を返す関数だから
// (テストは両方に同じ期待を書いてある)。
//
// 日時は ISO 文字列のまま比べる。同期 API が出すのは Date#toJSON の形
// (`2026-08-01T00:00:00.000Z`) だけで、桁数・区切り・UTC が固定されている =
// 辞書順が時系列順になる。Date を作り直すより速く、時計のずれとも無縁。
//
// 文字列の大小は符号位置で比べる (localeCompare は使わない)。本番の
// PostgreSQL は alpine (musl) の上で動いており、照合順序は実質バイト順。
// ICU の言語別規則で並べ直すと、かえってサーバの一覧とずれる。

import type { Sort } from '@/lib/validation'
import type { OfflineItem } from './item'

// 昇順を 1、降順を -1 で表す。SQL の ASC / DESC に対応する
type Direction = 1 | -1

// 符号位置の辞書順。localeCompare を避ける理由は冒頭のとおり
function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

// null を**向きに関わらず末尾**へ回す (SQL の NULLS LAST と同じ)。
// 逆順にしたとたん、番号として読めない itemNo や見出しの無いノートが先頭を
// 埋めるのでは、逆順にした意味 (端から辿る) が消える (sortOrder.ts と同じ判断)
function compareNullsLast<T>(
  a: T | null,
  b: T | null,
  direction: Direction,
  compare: (a: T, b: T) => number,
): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1
  }
  return compare(a, b) * direction
}

// 一覧の見出しとして並べる鍵。**URL モードの行だけ url を見る**のは
// ItemRow.tsx / sortOrder.ts と同じ切り分けで、ここを揃えないと
// 「画面に出ている見出しと違う順」になる。
// 空文字は NULLIF と同じく null に倒し、末尾へ回す
function titleKey(item: OfflineItem): string | null {
  const key = item.mode === 'url' ? item.url : item.title
  return key === '' ? null : key
}

// 並び順ごとの比較。**同着は必ず itemNo で決着させる** (下の tiebreak)。
// 揺れると、開き直すたびに一覧の順が変わって読み込みのたびに位置がずれる
// (docs/15 §2-2)
function primaryComparator(sort: Sort): (a: OfflineItem, b: OfflineItem) => number {
  switch (sort) {
    case 'itemNo':
      return (a, b) => compareNullsLast(a.itemNoNum, b.itemNoNum, 1, (x, y) => x - y)
    case 'itemNoDesc':
      return (a, b) => compareNullsLast(a.itemNoNum, b.itemNoNum, -1, (x, y) => x - y)
    case 'accessed':
      // 見ていないノートが同着になったときは更新順で解く
      return (a, b) =>
        compareText(b.accessedAt, a.accessedAt) || compareText(b.updatedAt, a.updatedAt)
    case 'accessedAsc':
      return (a, b) =>
        compareText(a.accessedAt, b.accessedAt) || compareText(a.updatedAt, b.updatedAt)
    case 'title':
      return (a, b) => compareNullsLast(titleKey(a), titleKey(b), 1, compareText)
    case 'titleDesc':
      return (a, b) => compareNullsLast(titleKey(a), titleKey(b), -1, compareText)
    case 'updatedAsc':
      return (a, b) => compareText(a.updatedAt, b.updatedAt)
    default:
      return (a, b) => compareText(b.updatedAt, a.updatedAt)
  }
}

// 検索結果を並べ替えた**新しい配列**を返す (Array#sort は元を書き換えるため)。
export function sortOfflineItems(
  items: readonly OfflineItem[],
  sort: Sort,
): OfflineItem[] {
  const primary = primaryComparator(sort)
  return [...items].sort(
    (a, b) => primary(a, b) || compareText(a.itemNo, b.itemNo),
  )
}
