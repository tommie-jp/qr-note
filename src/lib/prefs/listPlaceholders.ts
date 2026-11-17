// 検索一覧で先に出す空の枠の数を端末に覚える (docs/129 §1)。
//
// 1 ページ目が届いたら、続きのノートの枠 (中身なし) を読み込み済みの先まで
// 並べ、スクロールできるようにする。枠が画面に近づいたら中身を取りに行く。
//
// **端末ごと**にする。回線の速い PC は多めに、キャリアの iPhone は少なめに、
// のように使い分ける (スキャン音・テキストサイズと同じ判断)。
// 段は離散 (− / ＋ で 1 段ずつ。prefs/scanBeepVolume.ts と同じ理由)。
// 0 は「出さない」= 今までの「さらに表示」だけの一覧
import 'client-only'
import { createExternalStore } from './externalStore'
import { browserStorage, definePref, type PrefStorage } from './storagePref'

export const LIST_PLACEHOLDERS_STORAGE_KEY = 'qr-search:list-placeholders'

export const LIST_PLACEHOLDER_STEPS = [0, 20, 50, 100, 200, 500] as const

export type ListPlaceholderCount = (typeof LIST_PLACEHOLDER_STEPS)[number]

// 既定は 100 件 (5 ページ)。末尾まで一気に送られても、1 回に運ぶのはここまで
export const DEFAULT_LIST_PLACEHOLDERS: ListPlaceholderCount = 100

function isStep(value: number): value is ListPlaceholderCount {
  return (LIST_PLACEHOLDER_STEPS as readonly number[]).includes(value)
}

// 知らない値 (手で書き換えた・段を後から変えた) は既定に倒す
const LIST_PLACEHOLDERS_PREF = definePref<ListPlaceholderCount>({
  key: LIST_PLACEHOLDERS_STORAGE_KEY,
  parse: (raw) => {
    const n = Number(raw)
    return isStep(n) ? n : DEFAULT_LIST_PLACEHOLDERS
  },
  serialize: (count) => String(count),
  fallback: DEFAULT_LIST_PLACEHOLDERS,
})

export function loadListPlaceholders(storage: PrefStorage | null | undefined): ListPlaceholderCount {
  return LIST_PLACEHOLDERS_PREF.load(storage)
}

export function saveListPlaceholders(
  storage: PrefStorage | null | undefined,
  count: ListPlaceholderCount,
): void {
  LIST_PLACEHOLDERS_PREF.save(storage, count)
}

// ＋ / − を 1 段動かす。端では動かない
export function stepListPlaceholders(
  current: ListPlaceholderCount,
  direction: 1 | -1,
): ListPlaceholderCount {
  const next = LIST_PLACEHOLDER_STEPS.indexOf(current) + direction
  if (next < 0 || next >= LIST_PLACEHOLDER_STEPS.length) {
    return current
  }
  return LIST_PLACEHOLDER_STEPS[next]
}

export function listPlaceholdersLabel(count: ListPlaceholderCount): string {
  return count === 0 ? 'なし' : `${count} 件`
}

// メニューで変えたら開いている一覧にすぐ効かせる。サーバ描画では既定
const store = createExternalStore<ListPlaceholderCount>({
  initial: () => loadListPlaceholders(browserStorage()),
  serverSnapshot: DEFAULT_LIST_PLACEHOLDERS,
})

export function useListPlaceholders(): ListPlaceholderCount {
  return store.useStore()
}

export function setListPlaceholders(count: ListPlaceholderCount): void {
  saveListPlaceholders(browserStorage(), count)
  store.set(count)
}
