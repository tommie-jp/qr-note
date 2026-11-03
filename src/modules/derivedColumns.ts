// モジュールが items に足した派生列 (docs/126 §1-7)。core はこのファイルと
// registry.ts だけを import する (eslint で他は禁止)。
//
// derivedFromMemo (items/write.ts) が保存のたびに呼ぶ。DB にも React にも
// 触らない純関数だけを集める (バックフィルのスクリプトからも呼ぶ)
import { eventColumnsOf } from './calendar/event/eventColumns'

export function moduleDerivedColumns(memo: string) {
  return {
    ...eventColumnsOf(memo),
  }
}
