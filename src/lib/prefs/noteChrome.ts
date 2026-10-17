// ノートの操作 (見出し行・タグ・タブ・時刻) を畳むか (docs/108-ノート全画面表示計画.md)。
//
// 既定は畳んで、上端の行へのホバー・⋯・Tab で本文の上に重ねて出す。
// 「常に出す」は**端末ごとの好み** (prefs/notePager.ts と同じ判断): 畳むのが
// 煩わしい人はどのノートでも煩わしい。
//
// 正本を React の外 (localStorage) に置くのも notePager と同じ理由 — 切り替える
// 📌 は重ねた面の中に、それを読む MemoPanel は本文の器に居て、portal を挟むと
// どちらが親か一目で分からなくなる。購読すればどこからでも同じ値が見える。

import 'client-only'
import { createExternalStore } from './externalStore'
import {
  browserStorage,
  defineBooleanPref,
  type PrefStorage,
} from './storagePref'

export const NOTE_CHROME_PINNED_STORAGE_KEY = 'qr-search:note-chrome-pinned'

// 既定は畳む。本文を先に見せるのがこの機能の目的
export const NOTE_CHROME_PINNED_DEFAULT = false

const NOTE_CHROME_PINNED_PREF = defineBooleanPref(
  NOTE_CHROME_PINNED_STORAGE_KEY,
  NOTE_CHROME_PINNED_DEFAULT,
)

export type NoteChromeLayout = 'inline' | 'overlay'

interface NoteChromeLayoutInput {
  // 畳める器 (NoteChromeProvider) の中に居るか。公開ビューは居ない
  readonly collapsible: boolean
  // 「常に出す」の好み
  readonly pinned: boolean
  // 編集タブを開いているか。編集中に戻り口を消さない (docs/108 §2)
  readonly editing: boolean
}

// inline … 従来どおり本文の上に積む。overlay … 畳んで、呼んだときだけ重ねる
export function noteChromeLayout({
  collapsible,
  pinned,
  editing,
}: NoteChromeLayoutInput): NoteChromeLayout {
  return collapsible && !pinned && !editing ? 'overlay' : 'inline'
}

// 保存されていない・読めない・知らない値はすべて既定に倒す
export function parseNoteChromePinnedPref(raw: string | null): boolean {
  return NOTE_CHROME_PINNED_PREF.parse(raw)
}

export function loadNoteChromePinnedPref(
  storage: PrefStorage | null | undefined,
): boolean {
  return NOTE_CHROME_PINNED_PREF.load(storage)
}

export function saveNoteChromePinnedPref(
  storage: PrefStorage | null | undefined,
  pinned: boolean,
): void {
  NOTE_CHROME_PINNED_PREF.save(storage, pinned)
}

// 以下、購読の口 (notePager.ts と同じ形)。
// **サーバ描画では必ず既定** — 端末の好みはブラウザにしかない。「常に出す」の
// 端末ではハイドレーションの後に積む形へ切り替わる (docs/108 §3-4 の割り切り)
const pinnedStore = createExternalStore<boolean>({
  initial: () => loadNoteChromePinnedPref(browserStorage()),
  serverSnapshot: NOTE_CHROME_PINNED_DEFAULT,
})

export function setNoteChromePinned(pinned: boolean): void {
  // 覚えられなくても、その場の切り替えは効いている
  saveNoteChromePinnedPref(browserStorage(), pinned)
  pinnedStore.set(pinned)
}

export function useNoteChromePinned(): boolean {
  return pinnedStore.useStore()
}
