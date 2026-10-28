import { createExternalStore } from '@/lib/prefs/externalStore'
import { itemIdFromPathname } from '@/lib/search/url'

// 押したノートの題 (docs/86 §4-18)。
//
// ノートを開くと、本文がサーバから届くまでペインには骨組みの箱しか出せない。
// 題は押した行が既に持っているので、それを読み込み中の器 (PendingNoteFrame)
// に先に出す。サーバを待たずに「どのノートを開いたか」が判る。
//
// 行のリンクは Server Component なので onClick を持てない。代わりに
// data-note-title を付け、検索画面の根 (PaneModeProvider) が document で
// クリックを拾ってここへ置く

export interface NoteHint {
  readonly itemId: string
  readonly title: string
}

export const noteHintStore = createExternalStore<NoteHint | null>({
  initial: () => null,
  serverSnapshot: null,
})

// 修飾キー付き (新しいタブ) や中ボタンは、この画面が遷移しないので拾わない
export function isPlainClick(
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

// 行のリンクの行き先と題から、器に出す印を作る。ノート以外への行き先や
// 題の無いリンクは null
export function noteHintFromLink(href: string, title: string | undefined, base: string): NoteHint | null {
  if (!title) {
    return null
  }
  const itemId = itemIdFromPathname(new URL(href, base).pathname)
  return itemId === null ? null : { itemId, title }
}

// クリックされた要素から題を拾う (検索画面の根が document で呼ぶ)
export function noteHintFromClick(event: MouseEvent): NoteHint | null {
  if (!isPlainClick(event) || !(event.target instanceof Element)) {
    return null
  }
  const link = event.target.closest<HTMLAnchorElement>('a[data-note-title]')
  return link === null
    ? null
    : noteHintFromLink(link.href, link.dataset.noteTitle, window.location.href)
}
