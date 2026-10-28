// フォルダーペインに並べるタグを絞る (docs/118 §3)。
//
// フォルダーは「よく使う入口」であって、タグの全目録ではない (全目録は検索窓の
// 補完が持つ)。本番はタグが 1,581 種あり、全部を Link で描くと 3 ペインの
// 検索 1 回で展開後 2.2MB・画面の要素 1.2 万になっていた。
// 1,199 種は 1 ノートにしか付いておらず、611 種は旧番号 (`#1003` 等) だった。
import type { TagCount } from '@/lib/items/read'

// この件数に満たないタグはフォルダーにしない
export const FOLDER_TAG_MIN_COUNT = 2

// 数字だけのタグ (旧番号。docs/107 §4-5 で本文へ移した物)。全角の数字も含む
const DIGITS_ONLY = /^[\p{Nd}]+$/u

export interface FolderTags {
  readonly shown: TagCount[]
  // 絞って見せなかった数 (黙って減らすと「タグが消えた」に見える)
  readonly hidden: number
}

// 並びは入力のまま。件数の多い順などは listTags が決める
export function folderTags(tags: readonly TagCount[]): FolderTags {
  const shown = tags.filter(
    (t) => t.count >= FOLDER_TAG_MIN_COUNT && !DIGITS_ONLY.test(t.tag),
  )
  return { shown, hidden: tags.length - shown.length }
}
