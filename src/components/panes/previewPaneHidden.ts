// 下のペインを境界の引き切りで隠した、という知らせ (docs/86 §4-19)。
//
// 下のペインに出ている物 (ノート・画像ビューア・カレンダーの日の一覧) は持ち主が
// ばらばらで、境界 (PaneResizer) はどれが出ているかを知らない。1 ペインへ移ると
// それぞれ全画面・覆い・浮かせる一覧に化けて画面を覆うので、知らせを受けて
// 自分で閉じてもらう。ノートは URL が正なので、境界の側が一覧の URL へ戻す
import { searchHrefKeepingView } from '@/components/search/resultViewHref'

const listeners = new Set<() => void>()

export function onPreviewPaneHidden(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyPreviewPaneHidden(): void {
  for (const listener of listeners) {
    listener()
  }
}

// ノートの URL (/item/<id>?q=…&sort=…&cal=…) から、同じ検索の一覧の URL を作る。
// ノートに居なければ null (戻す必要が無い)
export function listHrefFromItemUrl(url: URL): string | null {
  if (!url.pathname.startsWith('/item/')) {
    return null
  }
  return searchHrefKeepingView(url.searchParams)
}
