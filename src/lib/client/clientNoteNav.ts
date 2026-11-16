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

// ---- 一覧の行のダブルクリックで編集画面へ ----
//
// 横取りしたクリックのうち、**この印の付いたリンク (一覧の行・画像タイル)** の
// 素の左クリックを控え、間を置かずに同じ所がもう一度押されたら編集画面へ送る。
// 前後ナビや表の行には付けない (連打してページを送る操作とぶつかる)
export const ROW_EDIT_ATTR = 'data-row-edit'

// 2 回目を「ダブルクリック」と見なす間と、指 (カーソル) のずれの許し。
// 間は OS の既定 (Windows 500ms) に合わせる
export const DOUBLE_CLICK_MS = 500
export const DOUBLE_CLICK_SLOP_PX = 8

// ブラウザの dblclick を使わないのは、**1 ペインでは 1 回目でノートが一覧を
// 覆う**から。2 回目の的が行ではなくノートの器になり、dblclick が出るかは
// ブラウザ任せになる。控えと座標・時刻で判定すれば、的が何に変わっても同じ
export interface RowClickMark {
  itemId: string
  x: number
  y: number
  at: number
}

// 押されたのが印の付いた行のリンクなら、その行のノートの番号
export function rowEditItemId(target: EventTarget | null, origin: string): string | null {
  if (!(target instanceof Element)) {
    return null
  }
  const anchor = target.closest(`a[href][${ROW_EDIT_ATTR}]`)
  if (!(anchor instanceof HTMLAnchorElement)) {
    return null
  }
  const href = clientNoteHref(anchor.href, origin)
  return href === null ? null : itemIdFromPathname(new URL(href, origin).pathname)
}

// 控え (1 回目) に対して、今回のクリックが 2 回目に当たるか
export function isSecondRowClick(
  mark: RowClickMark | null,
  click: { x: number; y: number; at: number },
): mark is RowClickMark {
  return (
    mark !== null &&
    click.at - mark.at <= DOUBLE_CLICK_MS &&
    Math.abs(click.x - mark.x) <= DOUBLE_CLICK_SLOP_PX &&
    Math.abs(click.y - mark.y) <= DOUBLE_CLICK_SLOP_PX
  )
}

// ノートの編集画面の URL
export function editNoteHref(itemId: string): string {
  return `/edit/${itemId}`
}
