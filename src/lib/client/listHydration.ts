// 端末に残した一覧の控え (listPersist.ts) の読み込みを、最初の取得が待つための
// 待ち合わせ (docs/129 §3)。
//
// 控えが先に入っていれば、最初の取得から If-None-Match を付けられ、変わって
// いなければ 304 で本文を運ばずに済む。待つのは短い上限まで — IndexedDB が
// 詰まった端末で検索そのものを遅らせない。
//
// listStore と listPersist が互いを読まないよう、待ち合わせだけをここに置く
import 'client-only'

// 待つ上限 (ms)。IndexedDB の読みは普段 10〜50ms
export const HYDRATION_WAIT_MS = 300

let hydration: Promise<void> | null = null

export function setListHydration(promise: Promise<void>): void {
  hydration = promise
}

export function waitForListHydration(limitMs: number = HYDRATION_WAIT_MS): Promise<void> {
  if (hydration === null) {
    return Promise.resolve()
  }
  return Promise.race([
    hydration,
    new Promise<void>((resolve) => {
      setTimeout(resolve, limitMs)
    }),
  ])
}
