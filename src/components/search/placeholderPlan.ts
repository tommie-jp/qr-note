// 検索一覧の末尾に並べる空の枠の割り付け (docs/129 §1)。DOM 無しで置く。
//
// 枠はページ (20 件) ごとの塊にする。塊が画面に近づいたら、その塊のページ
// までを 1 回で取りに行く (listStore の loadThrough)
import { PAGE_SIZE } from '@/lib/items/limits'
import type { ViewMode } from '@/lib/prefs/viewMode'

export interface PlaceholderChunk {
  // この塊を埋めるページ
  page: number
  // 塊の枠の数
  count: number
}

export interface PlaceholderInput {
  // 出している (読み込み済みの) ノートの数
  loaded: number
  total: number
  // 読み終えたページ
  page: number
  pageCount: number
  // 先に並べる枠の上限 (メニューの「一覧の枠」)。0 なら出さない
  limit: number
}

export function planPlaceholders({ loaded, total, page, pageCount, limit }: PlaceholderInput): PlaceholderChunk[] {
  let rest = Math.max(0, Math.min(total - loaded, limit))
  const chunks: PlaceholderChunk[] = []
  for (let next = page + 1; rest > 0 && next <= pageCount; next += 1) {
    const count = Math.min(PAGE_SIZE, rest)
    chunks.push({ page: next, count })
    rest -= count
  }
  return chunks
}

// 塊のうち、画面に入っている物の最後のページ (無ければ null)
export function lastVisiblePage(visible: ReadonlySet<number>): number | null {
  return visible.size === 0 ? null : Math.max(...visible)
}

// 枠 1 つの高さ。行の見積もり (lib/items/itemRowDecor.ts の ROW_SKIP_OFFSCREEN_CLASS)
// と同じ値にして、埋まったときに位置がずれにくくする
export const PLACEHOLDER_HEIGHT: Record<ViewMode, string> = {
  compact: '2.25rem',
  medium: '3.5rem',
  card: '7.5rem',
  image: '8rem',
}
