// ページ送りを使うか、全ページを続けて出すか (docs/82-ノート操作アイコン計画.md §3)。
//
// **ノート単位ではなく端末単位**にする。ページ送りが煩わしい人はどのノートでも
// 煩わしいはずで、ノートごとに覚えると開くたびに本文の長さが変わって落ち着かない
// (livePreviewPref.ts と同じ判断)。
//
// **正本は React の外に置く** (secretSession.ts と同じ形)。切り替えるボタンは
// 見出し行に、切り替わる本文は本文パネルの奥にあり、間に Server Component が
// 挟まって props でも context でも繋げない。localStorage をそのまま正本に
// すれば、購読している部品はどこに居ても一緒に切り替わる。
//
// 前半は Storage を引数で受ける純関数 (livePreviewPref.ts と同じ流儀)。
// 後半がその上に載る購読の口。

import { useSyncExternalStore } from 'react'

// localStorage は全部は要らないので、使う分だけの形で受ける (テスト容易性)
export type NotePagerStorage = Pick<Storage, 'getItem' | 'setItem'>

export const NOTE_PAGER_STORAGE_KEY = 'qr-search:note-pager'

// **既定はページ送りあり**。ページ (docs/74) を書いた人はそのつもりで
// 区切っているので、既定を通し表示にすると意図した畳み方が消える。
// 一度でも切り替えた端末は保存値が優先される
export const NOTE_PAGER_DEFAULT = true

// 保存されていない・読めない・知らない値はすべて既定に倒す
// (localStorage は外部入力として扱う)
export function parseNotePagerPref(raw: string | null): boolean {
  if (raw === '1') {
    return true
  }
  if (raw === '0') {
    return false
  }
  return NOTE_PAGER_DEFAULT
}

export function loadNotePagerPref(storage: NotePagerStorage): boolean {
  try {
    return parseNotePagerPref(storage.getItem(NOTE_PAGER_STORAGE_KEY))
  } catch {
    // プライベートモード等で読めない環境では既定で動く (設定は保険であって
    // 本筋ではない。ノートそのものは従来どおり読める)
    return NOTE_PAGER_DEFAULT
  }
}

export function saveNotePagerPref(
  storage: NotePagerStorage,
  paged: boolean,
): void {
  try {
    storage.setItem(NOTE_PAGER_STORAGE_KEY, paged ? '1' : '0')
  } catch {
    // 書けなくてもその場の切り替えは効いている (次に開くと既定に戻るだけ)
  }
}

// 以下、購読の口 (secretSession.ts と同じ形)。
//
// **window.localStorage を触ること自体が例外になる**ブラウザがある
// (Cookie を全面禁止した Chrome など)。上の純関数は getItem / setItem の中の
// 例外しか見ないので、`window.localStorage` を読む所も包む

// 読んだ値を覚えておく。useSyncExternalStore は描画のたびに何度も
// スナップショットを読むので、そのつど localStorage を叩かない
let cached: boolean | null = null

const listeners = new Set<() => void>()

export function isNotePagerPaged(): boolean {
  if (cached === null) {
    try {
      cached = loadNotePagerPref(window.localStorage)
    } catch {
      cached = NOTE_PAGER_DEFAULT
    }
  }
  return cached
}

export function setNotePagerPaged(paged: boolean): void {
  cached = paged
  try {
    saveNotePagerPref(window.localStorage, paged)
  } catch {
    // 覚えられなくても、その場の切り替えは効いている
  }
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeNotePagerPref(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ページ送りを使うかを購読する。**サーバ描画では必ず既定** — 端末の設定は
// ブラウザにしかないので、サーバが描いた HTML と食い違わせないために
// useSyncExternalStore の第 3 引数へ既定を渡す (React がハイドレーションの
// 後に読み直す)
export function useNotePagerPaged(): boolean {
  return useSyncExternalStore(
    subscribeNotePagerPref,
    isNotePagerPaged,
    () => NOTE_PAGER_DEFAULT,
  )
}
