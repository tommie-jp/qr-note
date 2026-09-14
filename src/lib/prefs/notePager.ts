// ページ送りを使うか、全ページを続けて出すか (docs/82-ノート操作アイコン計画.md §3)。
//
// **ノート単位ではなく端末単位**にする。ページ送りが煩わしい人はどのノートでも
// 煩わしいはずで、ノートごとに覚えると開くたびに本文の長さが変わって落ち着かない
// (prefs/livePreview.ts と同じ判断)。
//
// **正本は React の外に置く** (secret/session.ts と同じ形)。切り替えるボタンは
// 見出し行に、切り替わる本文は本文パネルの奥にあり、間に Server Component が
// 挟まって props でも context でも繋げない。localStorage をそのまま正本に
// すれば、購読している部品はどこに居ても一緒に切り替わる。
//
// 前半は Storage を引数で受ける純関数 (prefs/livePreview.ts と同じ流儀)。
// 後半がその上に載る購読の口。読み書きの例外の扱いは prefs/storagePref.ts。

import 'client-only'
import { createExternalStore } from './externalStore'
import {
  browserStorage,
  defineBooleanPref,
  type PrefStorage,
} from './storagePref'

export const NOTE_PAGER_STORAGE_KEY = 'qr-search:note-pager'

// **既定はページ送りあり**。ページ (docs/74) を書いた人はそのつもりで
// 区切っているので、既定を通し表示にすると意図した畳み方が消える。
// 一度でも切り替えた端末は保存値が優先される
export const NOTE_PAGER_DEFAULT = true

// プライベートモード等で読めない環境では既定で動く (設定は保険であって
// 本筋ではない。ノートそのものは従来どおり読める)。書けなくてもその場の
// 切り替えは効いている (次に開くと既定に戻るだけ)
const NOTE_PAGER_PREF = defineBooleanPref(
  NOTE_PAGER_STORAGE_KEY,
  NOTE_PAGER_DEFAULT,
)

// 保存されていない・読めない・知らない値はすべて既定に倒す
// (localStorage は外部入力として扱う)
export function parseNotePagerPref(raw: string | null): boolean {
  return NOTE_PAGER_PREF.parse(raw)
}

export function loadNotePagerPref(
  storage: PrefStorage | null | undefined,
): boolean {
  return NOTE_PAGER_PREF.load(storage)
}

export function saveNotePagerPref(
  storage: PrefStorage | null | undefined,
  paged: boolean,
): void {
  NOTE_PAGER_PREF.save(storage, paged)
}

// 以下、購読の口 (secret/session.ts と同じ形。prefs/externalStore.ts)。
//
// **window.localStorage を触ること自体が例外になる**ブラウザがある
// (Cookie を全面禁止した Chrome など)。browserStorage がそれを null (= 既定) に畳む

// 読んだ値はストアが覚えておく。useSyncExternalStore は描画のたびに何度も
// スナップショットを読むので、そのつど localStorage を叩かない。
//
// **サーバ描画では必ず既定** — 端末の設定はブラウザにしかないので、サーバが
// 描いた HTML と食い違わせないために serverSnapshot へ既定を渡す (React が
// ハイドレーションの後に読み直す)
const pagedStore = createExternalStore<boolean>({
  initial: () => loadNotePagerPref(browserStorage()),
  serverSnapshot: NOTE_PAGER_DEFAULT,
})

export function isNotePagerPaged(): boolean {
  return pagedStore.get()
}

export function setNotePagerPaged(paged: boolean): void {
  // 覚えられなくても、その場の切り替えは効いている
  saveNotePagerPref(browserStorage(), paged)
  pagedStore.set(paged)
}

export function subscribeNotePagerPref(listener: () => void): () => void {
  return pagedStore.subscribe(listener)
}

// ページ送りを使うかを購読する (サーバ描画では既定)
export function useNotePagerPaged(): boolean {
  return pagedStore.useStore()
}
