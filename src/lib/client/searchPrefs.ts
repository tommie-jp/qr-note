// 検索一覧の並び順の好み (cookie) を端末で持つ (docs/123 §4-2)。
//
// 並び順は URL → cookie → 既定 で決まる (prefs/sortMode.ts の resolveSort)。
// 既定 (updated) は URL に載らないので、cookie の値を端末が知らないと
// 「既定に戻した」が URL から読めない。初期値はサーバが cookie から読んだ値を
// SearchPrefsSeed が入れ、並び替えの action が書き換える
import 'client-only'
import { createExternalStore } from '@/lib/prefs/externalStore'
import type { Sort } from '@/lib/validation'

export const searchSortStore = createExternalStore<Sort | null>({
  initial: () => null,
  serverSnapshot: null,
})
