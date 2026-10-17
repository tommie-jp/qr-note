// ノート本文の画像を幅に合わせるか、全体を表示するか (docs/106-画像表示モード計画.md)。
//
// PDF ビュアーの「幅に合わせる / ページ全体」と同じ 2 値。
// - page  … 幅と高さの両方に収める。縦長のイラストも 1 画面で全体が見える
// - width … 幅いっぱいに出す (これまでの見た目)。縦長は画面からはみ出す
// 横長の画像はどちらでも同じ見た目になる (幅で先に詰まるため)。
//
// **ノート単位ではなく端末単位**にする。幅で見たい人はどのノートでも幅で
// 見たいはずで、ノートごとに覚えると開くたびに見た目が変わって落ち着かない
// (prefs/notePager.ts と同じ判断)。
//
// **正本は React の外 (localStorage)**。切り替えるボタンは見出し行に、
// 効く本文は本文パネルの奥にあり、間に Server Component が挟まって props でも
// context でも繋げない (prefs/notePager.ts と同じ形)。

import 'client-only'
import { createExternalStore } from './externalStore'
import { browserStorage, definePref, type PrefStorage } from './storagePref'

export type ImageFit = 'page' | 'width'

export const IMAGE_FIT_STORAGE_KEY = 'qr-search:image-fit'

// **既定は全体を表示**。縦長のイラストを 1 枚ずつスクロールして眺めるより、
// まず全体が見えるほうが読む流れを切らない。細部は拡大表示 (ZoomableImage) で見る。
// サーバ描画もこの値で描くので、既定の人は読み込み直後に跳ねない
export const IMAGE_FIT_DEFAULT: ImageFit = 'page'

const IMAGE_FIT_PREF = definePref<ImageFit>({
  key: IMAGE_FIT_STORAGE_KEY,
  // 知らない値は既定に倒す (localStorage は外部入力)
  parse: (raw) => (raw === 'width' ? 'width' : IMAGE_FIT_DEFAULT),
  serialize: (value) => value,
  fallback: IMAGE_FIT_DEFAULT,
})

export function parseImageFitPref(raw: string | null): ImageFit {
  return IMAGE_FIT_PREF.parse(raw)
}

export function loadImageFitPref(
  storage: PrefStorage | null | undefined,
): ImageFit {
  return IMAGE_FIT_PREF.load(storage)
}

export function saveImageFitPref(
  storage: PrefStorage | null | undefined,
  fit: ImageFit,
): void {
  IMAGE_FIT_PREF.save(storage, fit)
}

// 以下、購読の口 (prefs/notePager.ts と同じ形)。
// **サーバ描画では必ず既定** — 端末の設定はブラウザにしかない
const fitStore = createExternalStore<ImageFit>({
  initial: () => loadImageFitPref(browserStorage()),
  serverSnapshot: IMAGE_FIT_DEFAULT,
})

export function setImageFit(fit: ImageFit): void {
  // 覚えられなくても、その場の切り替えは効いている
  saveImageFitPref(browserStorage(), fit)
  fitStore.set(fit)
}

export function useImageFit(): ImageFit {
  return fitStore.useStore()
}
