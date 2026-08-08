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

import { firstThumbInfo, thumbUrl } from '@/lib/memoImages'
import { saveOfflineSnapshot } from './db'
import { parseSyncPayload, SYNC_ITEMS_PATH, type OfflineItem, type OfflineSyncPayload } from './item'

// 応答の封筒 ({ success, data, error }) から data を取り出す。
// **サーバを無条件には信じない** (searchQueryClient.ts と同じ流儀)
function readEnvelope(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  return (body as { data?: unknown }).data ?? null
}

// ノート本文を取り込んで IndexedDB へ置き換える。失敗したら投げる。
//
// cache: 'no-store' … 「今どうなっているか」しか意味がない口なので、中間
// キャッシュに持たれると別の端末で足したノートがいつまでも届かない。
// Service Worker 側もこの口はキャッシュしない (sw.js の API 判定と対)。
export async function syncOfflineItems(): Promise<OfflineSyncPayload> {
  const res = await fetch(SYNC_ITEMS_PATH, { cache: 'no-store' })
  if (!res.ok) {
    // 401 はセッション切れ。proxy.ts が画面を 200 で案内へ差し替えるのと違い、
    // この口は必ず 401 を返すので、ここで「ログインし直し」と言い切れる
    throw new Error(
      res.status === 401
        ? 'ログインの期限が切れています。ログインし直してください'
        : `同期に失敗しました (HTTP ${res.status})`,
    )
  }

  const payload = parseSyncPayload(readEnvelope(await res.json()))
  if (payload === null) {
    throw new Error('同期の応答を読み取れませんでした')
  }

  await saveOfflineSnapshot(payload)
  return payload
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
