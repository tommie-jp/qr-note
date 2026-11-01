// 検索画面の中でノートを開く遷移を、サーバへ行かずに端末で済ませる
// (docs/123 §12)。
//
// App Router のソフト遷移は、本文を端末が持っていても /item の RSC (殻) を
// 取りに行き、その応答を待ってから器を出す。iPhone のキャリア回線では
// この 1 往復が 135〜192ms あった (§12-1)。ここでは history.pushState で URL
// だけを /item/<id> にし、器は検索画面の layout に居る ClientNotePane が
// URL から描く。Next は外からの pushState を「取りに行かない復元」として
// 受け、usePathname / useSearchParams を新しい URL に合わせる
// (node_modules/next/dist/client/components/app-router.js の
// applyUrlFromHistoryPushReplace)。
//
// 横取りするのは **data-client-note を付けたリンクだけ** (一覧の行・画像タイル・
// 前後ナビ・ビューアの「ノートを開く」・表の行)。本文に手書きしたリンクは
// 素の <a> のハード遷移のまま残す (今までどおり全画面の /item に着く)
import 'client-only'
import { itemIdFromPathname } from '@/lib/search/url'
import { isValidItemId } from '@/lib/validation'

// 横取りしてよいリンクの目印。値は持たない
export const CLIENT_NOTE_ATTR = 'data-client-note'

// ClientNotePane が居る間だけ立つ。居ない画面 (全画面の /item・ゴミ箱・
// 設定) では横取りせず、Next のふつうの遷移に任せる
let mountedPanes = 0

export function registerClientNotePane(): () => void {
  mountedPanes += 1
  return () => {
    mountedPanes -= 1
  }
}

export function clientNotePaneActive(): boolean {
  return mountedPanes > 0
}

// 端末で開いてよい行き先なら、pushState に渡すパス (+ query + hash) を返す。
// 同じ origin の /item/<UUID> ちょうどだけ。旧番号 (/item/1003) は解決に
// サーバが要るので外す (横取りスロットが受ける)。/item/<id>/history など
// 深いパスも外す
export function clientNoteHref(href: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(href, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) {
    return null
  }
  const itemId = itemIdFromPathname(url.pathname)
  if (itemId === null || !isValidItemId(itemId)) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}

interface ClickLike {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

// 押されたのが「端末で開いてよいリンクの素の左クリック」なら行き先を返す。
// 修飾キー付き (別タブ・別窓) と target 付きは、ブラウザの動きに任せる
export function clientNoteClickHref(event: ClickLike, origin: string): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null
  }
  const target = event.target
  if (!(target instanceof Element)) {
    return null
  }
  const anchor = target.closest(`a[href][${CLIENT_NOTE_ATTR}]`)
  if (!(anchor instanceof HTMLAnchorElement)) {
    return null
  }
  if ((anchor.target !== '' && anchor.target !== '_self') || anchor.hasAttribute('download')) {
    return null
  }
  return clientNoteHref(anchor.href, origin)
}

// URL を変えるだけ。器は ClientNotePane が URL から描く。
// 今と同じ URL への push は履歴を 1 段増やすだけなので replace に倒す
// (ブラウザがリンクの同一 URL を扱うのと同じ)
export function openClientNote(href: string, { replace = false }: { replace?: boolean } = {}): void {
  const current = `${location.pathname}${location.search}${location.hash}`
  if (replace || href === current) {
    window.history.replaceState(null, '', href)
  } else {
    window.history.pushState(null, '', href)
  }
}

// 端末で開いたノートを出しているか。ClientNotePane が居て、URL が
// /item/<UUID> を指している間
export function showingClientNote(): boolean {
  if (!clientNotePaneActive()) {
    return false
  }
  const itemId = itemIdFromPathname(location.pathname)
  return itemId !== null && isValidItemId(itemId)
}
