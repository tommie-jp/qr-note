// スライドショーの送り間隔を端末に覚える (docs/117-検索結果のスライドショー計画.md)。
//
// **端末ごと**にする。PC の大きな画面でじっくり見る間隔と、iPhone で
// 流し見する間隔は違う (スキャン音量・テキストサイズと同じ判断)。
//
// 段は離散 (3 / 5 / 10 秒)。覆いの釦を押すたびに次の段へ回る — 片手で
// 狙いにくいスライダーは置かない (prefs/scanBeepVolume.ts と同じ理由)。
// 読み取り例外の扱いは prefs/storagePref.ts

import 'client-only'
import { createExternalStore } from './externalStore'
import { browserStorage, definePref, type PrefStorage } from './storagePref'

export const SLIDESHOW_INTERVAL_STORAGE_KEY = 'qr-search:slideshow-interval'

// 秒。この並びがそのまま釦の循環の順になる
export const SLIDESHOW_INTERVALS = [3, 5, 10] as const

export type SlideshowInterval = (typeof SLIDESHOW_INTERVALS)[number]

// 写真 1 枚を眺めて次へ行くのに 5 秒。3 秒は流し見、10 秒はじっくり
export const DEFAULT_SLIDESHOW_INTERVAL: SlideshowInterval = 5

function isSlideshowInterval(value: number): value is SlideshowInterval {
  return (SLIDESHOW_INTERVALS as readonly number[]).includes(value)
}

// 知らない値 (手で書き換えた・段を後から変えた) は既定に倒す
const SLIDESHOW_INTERVAL_PREF = definePref<SlideshowInterval>({
  key: SLIDESHOW_INTERVAL_STORAGE_KEY,
  parse: (raw) => {
    const value = Number(raw)
    return isSlideshowInterval(value) ? value : DEFAULT_SLIDESHOW_INTERVAL
  },
  serialize: (value) => String(value),
  fallback: DEFAULT_SLIDESHOW_INTERVAL,
})

export function parseSlideshowInterval(raw: string | null): SlideshowInterval {
  return SLIDESHOW_INTERVAL_PREF.parse(raw)
}

export function loadSlideshowInterval(
  storage: PrefStorage | null | undefined,
): SlideshowInterval {
  return SLIDESHOW_INTERVAL_PREF.load(storage)
}

export function saveSlideshowInterval(
  storage: PrefStorage | null | undefined,
  value: SlideshowInterval,
): void {
  SLIDESHOW_INTERVAL_PREF.save(storage, value)
}

// 釦を押すたびに次の段へ。末尾の次は先頭に戻る
export function nextSlideshowInterval(current: SlideshowInterval): SlideshowInterval {
  const index = SLIDESHOW_INTERVALS.indexOf(current)
  return SLIDESHOW_INTERVALS[(index + 1) % SLIDESHOW_INTERVALS.length]
}

// 以下、購読の口 (prefs/notePager.ts と同じ形)。サーバ描画では既定
const intervalStore = createExternalStore<SlideshowInterval>({
  initial: () => loadSlideshowInterval(browserStorage()),
  serverSnapshot: DEFAULT_SLIDESHOW_INTERVAL,
})

export function setSlideshowInterval(value: SlideshowInterval): void {
  // 覚えられなくても、その場の切り替えは効いている
  saveSlideshowInterval(browserStorage(), value)
  intervalStore.set(value)
}

export function useSlideshowInterval(): SlideshowInterval {
  return intervalStore.useStore()
}
