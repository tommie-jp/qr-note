// 端末の写し (同期データ) を「id → ノート」で引ける形にして覚えておく
// (docs/123 §3-2・§5)。
//
// ノート画面は控え (API の応答) が届く前に、写しの本文を先に出す。写しは
// IndexedDB に 1 本の値 (約 11MB) で入っていて、読むたびに解すと重いので、
// 1 度だけ読んで Map にする。同期 (sync.ts) が新しい写しを受け取ったら
// 差し替える — 同期は 304 でも写しを読み戻しているので、それをそのまま使う
import 'client-only'
import type { CircuitMap } from '@/lib/circuit/types'
import { createExternalStore } from '@/lib/prefs/externalStore'
import { offlineCircuitMap } from './circuits'
import type { OfflineItem, OfflineSyncPayload } from './item'
import { loadOfflineSnapshot } from './snapshotDb'

export interface SnapshotIndex {
  readonly items: ReadonlyMap<string, OfflineItem>
  readonly circuits: CircuitMap
}

export const snapshotIndexStore = createExternalStore<SnapshotIndex | null>({
  initial: () => null,
  serverSnapshot: null,
})

let loading: Promise<void> | null = null

export function indexSnapshot(payload: OfflineSyncPayload): void {
  snapshotIndexStore.set({
    items: new Map(payload.items.map((item) => [item.itemId, item])),
    circuits: offlineCircuitMap(payload.circuits),
  })
}

// 写しを 1 度だけ読む。写しが無い・読めない端末では何も起きない (API を待つ)
export function ensureSnapshotIndex(): void {
  if (loading !== null || snapshotIndexStore.get() !== null || typeof indexedDB === 'undefined') {
    return
  }
  loading = loadOfflineSnapshot()
    .then((payload) => {
      if (payload !== null && snapshotIndexStore.get() === null) {
        indexSnapshot(payload)
      }
    })
    .catch((error: unknown) => {
      console.warn('端末の写しを読めませんでした', error)
    })
}
