// サーバから端末へノートを取り込む (docs/65-オフライン対応計画.md §3-2)。
//
// **本文の同期と画像の先読みを分ける**のがここの設計判断。
//
//   本文 … 全ノートで数百 KB。アプリを開くたびに黙って取り直してよい。
//   画像 … サムネだけでも数 MB〜十数 MB になりうる。電波の届く場所で勝手に
//          十数 MB 落とすのは、通信量を払う人に対して失礼なので**手動**にする
//          (/offline の「画像も保存」ボタン)。
//
// 端末側は常にサーバの写しにする (差分同期をしない理由は syncItems.ts)。
// 失敗は握り潰さず投げる — 「同期できていない」ことが画面に出ないと、
// 圏外で開いて初めて古いデータだったと気づくことになる。

import 'client-only'
import { snapshotChanged } from '@/lib/client/invalidate'
import { indexSnapshot, snapshotIndexStore } from './snapshotIndex'
import { envelopeData } from '@/lib/api/envelope'
import { firstThumbInfo, thumbUrl } from '@/lib/images/memoImages'
import { loadOfflineSnapshot, saveOfflineSnapshot } from './snapshotDb'
import { awaitResource, isPerfActive, perfNow, perfSend } from '@/lib/logging/perfClient'
import { formatTransfer, serverTimingSummary } from '@/lib/logging/perf'
import { perfMs } from '@/lib/logging/perfLine'
import { parseSyncPayload, SYNC_ITEMS_PATH, type OfflineItem, type OfflineSyncPayload } from './item'
import { canSyncByDelta, mergeSyncDelta, parseSyncDelta } from './syncDelta'

// 同期の結果。changed が false なら、サーバに変化が無く (304) 端末の写しを
// そのまま使っている (docs/118 §4-2)
export interface SyncResult {
  payload: OfflineSyncPayload
  changed: boolean
}

// ノート本文を取り込んで IndexedDB へ置き換える。失敗したら投げる。
//
// cache: 'no-store' … 「今どうなっているか」しか意味がない口なので、中間
// キャッシュに持たれると別の端末で足したノートがいつまでも届かない。
// Service Worker 側もこの口はキャッシュしない (sw.js の API 判定と対)。
//
// 写しに版 (etag) が残っていれば If-None-Match で送り、サーバが 304 を返したら
// 写しを触らずにそのまま返す (docs/118 §4-2)。11MB (gzip で 2.3MB) を毎回
// 受け直さないため。写しが無い・古い版の写しで etag が無いときは全件を取る
export async function syncOfflineItems(): Promise<SyncResult> {
  const t0 = perfNow()
  const stored = await loadOfflineSnapshot()
  // 前回の写しから差分に乗れるなら起点を付ける (docs/124 §4)
  const since = stored !== null && canSyncByDelta(stored, Date.now()) ? stored.cursor : undefined
  const first = await requestSync(stored, since)
  if (first.kind === 'unchanged' && stored !== null) {
    if (isPerfActive()) {
      perfSend('同期', [['結果', 304], ['全体', perfMs(perfNow() - t0)]])
    }
    // 変わっていなければ、索引が既にあれば作り直さない (約 11MB を舐め直さない)
    if (snapshotIndexStore.get() === null) {
      indexSnapshot(stored)
    }
    return { payload: stored, changed: false }
  }

  let response = first
  let payload = toPayload(stored, response)
  // 差分を写しに重ねられなかった (写しに無いノートが版の一覧にある等)。全件を取り直す
  if (payload === null && response.kind === 'delta') {
    response = await requestSync(null, undefined)
    payload = toPayload(null, response)
  }
  if (payload === null) {
    throw new Error('同期の応答を読み取れませんでした')
  }

  await saveOfflineSnapshot(payload)
  indexSnapshot(payload)
  snapshotChanged(new Map(payload.items.map((item) => [item.itemId, item.updatedAt])))
  if (isPerfActive() && response.kind !== 'unchanged') {
    void reportSync(payload, response.kind, { t0, ...response.at, tSaved: perfNow() })
  }
  return { payload, changed: true }
}

type SyncResponse =
  | { kind: 'unchanged' }
  | { kind: 'full' | 'delta'; data: unknown; at: { tHeaders: number; tBody: number } }

// 同期の口を 1 回叩く。stored が無ければ If-None-Match も付けない (全件を取る)
async function requestSync(
  stored: OfflineSyncPayload | null,
  since: string | undefined,
): Promise<SyncResponse> {
  const headers: Record<string, string> =
    stored?.etag === undefined ? {} : { 'If-None-Match': stored.etag }
  const url = since === undefined ? SYNC_ITEMS_PATH : `${SYNC_ITEMS_PATH}?since=${encodeURIComponent(since)}`
  const res = await fetch(url, { cache: 'no-store', headers })
  if (res.status === 304 && stored !== null) {
    return { kind: 'unchanged' }
  }
  if (!res.ok) {
    // 401 はセッション切れ。proxy.ts が画面を 200 で案内へ差し替えるのと違い、
    // この口は必ず 401 を返すので、ここで「ログインし直し」と言い切れる
    throw new Error(
      res.status === 401
        ? 'ログインの期限が切れています。ログインし直してください'
        : `同期に失敗しました (HTTP ${res.status})`,
    )
  }
  // 封筒から data を取り出す。**サーバを無条件には信じない** (envelopeData が
  // オブジェクトでない本文を null にし、形は parseSyncPayload / parseSyncDelta が確かめる)
  const tHeaders = perfNow()
  const body: unknown = await res.json()
  const tBody = perfNow()
  const data = envelopeData(body)
  const isDelta = typeof data === 'object' && data !== null && (data as { mode?: unknown }).mode === 'delta'
  return { kind: isDelta ? 'delta' : 'full', data, at: { tHeaders, tBody } }
}

// 応答を写しの形にする。差分は前回の写しに重ねる。読めなければ null
function toPayload(stored: OfflineSyncPayload | null, response: SyncResponse): OfflineSyncPayload | null {
  if (response.kind === 'unchanged') {
    return stored
  }
  if (response.kind === 'full') {
    return parseSyncPayload(response.data)
  }
  const delta = parseSyncDelta(response.data)
  return delta === null || stored === null ? null : mergeSyncDelta(stored, delta)
}

// 同期 1 回の行 (docs/119 §3-3)。resource entry (転送量・Server-Timing) は
// 受信完了の後に非同期で届くので、待ってから送る。同期そのものは待たせない
async function reportSync(
  payload: OfflineSyncPayload,
  kind: 'full' | 'delta',
  at: { t0: number; tHeaders: number; tBody: number; tSaved: number },
): Promise<void> {
  // 差分は ?since= が付くので、パスを含むかで拾う
  const entry = await awaitResource(
    (e) => e.name.includes(SYNC_ITEMS_PATH) && e.startTime >= at.t0 - 1,
  )
  perfSend('同期', [
    ['結果', 200],
    ['種類', kind === 'delta' ? '差分' : '全件'],
    ['全体', perfMs(at.tSaved - at.t0)],
    ['応答開始', perfMs(entry ? entry.responseStart - entry.startTime : at.tHeaders - at.t0)],
    // 本文 = 受信の残り + JSON の解析 (res.json() は両方を含む)
    ['本文', perfMs(at.tBody - at.tHeaders)],
    ['保存', perfMs(at.tSaved - at.tBody)],
    ['転送', formatTransfer(entry) ?? '未了'],
    ['件数', payload.items.length],
    ['回路', payload.circuits.length],
    ['サーバ', serverTimingSummary(entry) ?? '未対応'],
  ])
}

// 先読みの進み具合。done は「片付いた件数」で、キャッシュ済みで通信が
// 起きなかったものも数える (利用者から見れば同じく片付いた件数のため)
export interface PrefetchProgress {
  done: number
  total: number
}

// 同時に投げる本数。多すぎると回線を占有して他の操作が止まり、少なすぎると
// 数百件が終わらない。往復待ちが支配的な小さいファイル向けの手加減
const PREFETCH_CONCURRENCY = 6

// 一覧サムネを Service Worker のキャッシュへ入れる (docs/65-オフライン対応計画.md §3-3)。
//
// **自分では Cache Storage を触らない**のが要点。ただ fetch するだけで、
// 実際に保存するのは sw.js の /api/images/ の扱い (CacheFirst) —
// 保存の規則が 1 か所にしか無ければ、先読みと通常閲覧でずれようがない。
// 2 回目以降はキャッシュに当たって通信が起きないので、増えた分だけが落ちる。
//
// 対象を一覧サムネ (ノートあたり最大 1 枚) に絞るのは、本文に貼った原寸の
// 画像・動画まで含めると数百 MB になりうるため。原寸は**閲覧したときに**
// sw.js が同じ規則で拾う。
//
// 戻り値は取りこぼした件数。0 件でなくても失敗にはしない — 1 枚落ちても
// 他のサムネは使えるので、途中でやめるほうが損 (画面は数だけ知らせる)。
export async function prefetchOfflineThumbs(
  items: readonly OfflineItem[],
  onProgress?: (progress: PrefetchProgress) => void,
): Promise<number> {
  // **保存するのは Service Worker なので、居ないなら何も貯まらない。**
  // 黙って全部 fetch すると、通信だけして 0 件失敗 = 「保存しました」と
  // 嘘を伝えることになる (開発サーバ・未対応の端末・一部のプライベート
  // ブラウズで起きる)。先に断る
  if (typeof navigator === 'undefined' || navigator.serviceWorker?.controller == null) {
    throw new Error('この画面ではまだ画像を保存できません。開き直してから試してください')
  }

  const urls = items.flatMap((item) => {
    const thumb = firstThumbInfo(item.memo)
    return thumb === null ? [] : [thumbUrl(thumb.name)]
  })

  let done = 0
  let failed = 0
  let next = 0

  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]
      try {
        const res = await fetch(url)
        if (!res.ok) {
          failed++
        }
      } catch {
        // 圏外・中断。ここで投げると残りのサムネまで諦めることになる
        failed++
      }
      done++
      onProgress?.({ done, total: urls.length })
    }
  }

  onProgress?.({ done: 0, total: urls.length })
  await Promise.all(
    Array.from({ length: Math.min(PREFETCH_CONCURRENCY, urls.length) }, worker),
  )
  return failed
}
