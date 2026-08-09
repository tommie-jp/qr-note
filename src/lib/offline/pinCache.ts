// 印付きノートの持ち出し (docs/65-オフライン対応計画.md §10)。ブラウザ専用。
//
// ## 突き合わせにする理由
//
// 「印を付けたら落とす・外したら消す」と出来事で書くと、取りこぼしが永久に
// 残る。印を外した瞬間に圏外だった、別の端末で外した、添付を差し替えた、
// ノートごと消した — どれも起こるうえ、qr-pin-v1 は**期限で腐らない棚**
// なので、消し損ねた物は次に容量が問題になるまで誰にも気づかれない。
//
// そこで毎回、印付きノートから**あるべき URL の集合**を作り直し、棚と
// 突き合わせる。足りない物を落とし、余っている物を消す。手順が 1 つで済み、
// 途中で中断しても次回に続きから揃う。
//
// ## 自分で Cache Storage へ書く理由
//
// サムネの先読み (sync.ts) は「ただ fetch するだけ」で、保存は sw.js に任せて
// いる — 規則が 1 か所にあればずれようがないため。こちらはそうしない。
// 印の棚は**入れる物と消す物をこちらが決める**必要があり、fetch の副作用では
// 「余りを消す」が書けない。sw.js 側はこの棚を読むだけにしてある (pinnedFirst)。

import { allAttachments, attachmentUrl, thumbUrl } from '@/lib/memoImages'
import { allSecretNames, secretUrl } from '@/lib/secrets'
import { PIN_CACHE } from './cacheNames'
import type { OfflineItem } from './item'

// 同時に投げる本数。原寸の画像・動画を含むので、サムネ (sync.ts) より控えめに
// する — 30MB の動画を 6 本並行で落とすと回線を占有して他の操作が止まる
const PIN_CONCURRENCY = 3

export interface PinProgress {
  done: number
  total: number
}

export interface PinSyncResult {
  // 印の付いたノートの数
  notes: number
  // 端末に置いてある URL の数 (突き合わせ後)
  files: number
  // 落とせなかった数。0 でなくても失敗にはしない (他は使えるため)
  failed: number
  // 印が外れて消した数
  removed: number
}

// 印付きノート 1 件を圏外で開くのに要る URL 一式。
//
// 原寸とサムネの**両方**を入れる。サムネは一覧に出るもので、原寸を持って
// いても代わりにはならない (URL が違えばキャッシュは別物)。
export function pinnedUrls(item: OfflineItem): string[] {
  const urls: string[] = []
  for (const { name, hasThumb } of allAttachments(item.memo)) {
    urls.push(attachmentUrl(name))
    if (hasThumb) {
      urls.push(thumbUrl(name))
    }
  }
  // シークレット断片。運ぶのは暗号文で、鍵は端末の中にしかない (docs/51 §7)。
  // 断片の中に入れ子で貼られた媒体は、**開いてみないと判らない** (中身が
  // 暗号化されているので本文から辿れない) — 一度オンラインで開けば
  // sw.js が同じ規則で拾う
  for (const name of allSecretNames(item.memo)) {
    urls.push(secretUrl(name))
  }
  return urls
}

// 印付きノートの添付を端末へ揃える。あるべき集合と棚を突き合わせる。
//
// **Service Worker が居なくても動く。** 書くのはこちらなので、居ないと
// 困るのは「返す側」だけ — 揃えておけば、次に Worker が動き出したときから
// 効く (サムネの先読みが Worker 必須なのとは事情が違う)。
export async function syncPinnedAssets(
  items: readonly OfflineItem[],
  onProgress?: (progress: PinProgress) => void,
): Promise<PinSyncResult> {
  if (typeof caches === 'undefined') {
    throw new Error('この環境ではオフライン用の保存を使えません')
  }

  const pinned = items.filter((item) => item.pinned)
  const wanted = new Set(pinned.flatMap(pinnedUrls))
  const cache = await caches.open(PIN_CACHE)

  // 先に余りを消す。**順番が要点** — 容量の限られた端末で、消す前に落とすと
  // 「外した印の分が残ったまま新しい分を入れられない」で詰まる
  let removed = 0
  for (const request of await cache.keys()) {
    // 棚の鍵は絶対 URL、あるべき集合は本文から組んだ相対 URL
    // (`/api/images/…?thumb=1&v=4`)。query まで含めて突き合わせる —
    // サムネと原寸は path が同じで query だけが違う
    const { pathname, search } = new URL(request.url)
    if (!wanted.has(pathname + search)) {
      await cache.delete(request)
      removed++
    }
  }

  const missing: string[] = []
  for (const url of wanted) {
    if ((await cache.match(url)) === undefined) {
      missing.push(url)
    }
  }

  const total = missing.length
  let done = 0
  let failed = 0
  let next = 0
  onProgress?.({ done, total })

  const worker = async () => {
    while (next < total) {
      const url = missing[next++]
      try {
        const res = await fetch(url, { credentials: 'same-origin' })
        // 206 は来ない (Range を付けていない)。ok でない応答を入れると
        // 「圏外でログイン案内が画像として出る」ことになるので入れない
        if (res.ok && res.status === 200) {
          await cache.put(url, res)
        } else {
          failed++
        }
      } catch {
        // 圏外・中断・容量不足。ここで投げると残りまで諦めることになる。
        // 揃わなかった分は次の突き合わせで拾い直す
        failed++
      }
      done++
      onProgress?.({ done, total })
    }
  }

  await Promise.all(Array.from({ length: Math.min(PIN_CONCURRENCY, total) }, worker))

  return { notes: pinned.length, files: wanted.size, failed, removed }
}

// 端末が使っている保存容量の目安 (docs/65-オフライン対応計画.md §10)。
//
// **数字を出すのは、印を増やす判断の材料になるから。** 印は付けるほど容量を
// 食うのに、iOS は空き容量が減ると黙って Cache Storage ごと捨てる — 出して
// おけば「増やしすぎた」に自分で気づける。
//
// 使えない環境 (estimate 非対応) では null。出せないことを 0 と言わない。
export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || navigator.storage?.estimate === undefined) {
    return null
  }
  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (usage === undefined || quota === undefined) {
      return null
    }
    return { usage, quota }
  } catch (error) {
    console.warn('保存容量を調べられませんでした', error)
    return null
  }
}

// 端末に「この保存は勝手に捨てないでほしい」と申し入れる。
//
// 通るかどうかはブラウザ次第 (Chrome は利用状況で自動判断、Safari は
// ホーム画面に追加した PWA を優遇する)。**通らなくても機能は落ちない**ので
// 結果は返さず、記録だけ残す — 断られたことを画面に出しても、利用者に
// できることが無い。
//
// **利用者が押した流れからだけ呼ぶこと。** Firefox は persist() で確認バーを
// 出すので、画面を開いた副作用として撃つと「何もしていないのに許可を
// 求められた」になる (呼び出しは /offline の「印の分を保存」だけ)。
export async function requestPersistentStorage(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.storage?.persist === undefined) {
    return
  }
  try {
    // 既に許可されているなら聞き直さない (persisted は問い合わせるだけで
    // 副作用が無い。persist は環境によっては利用者への確認を伴う)
    if (await navigator.storage.persisted()) {
      return
    }
    await navigator.storage.persist()
  } catch (error) {
    console.warn('保存の永続化を申し入れられませんでした', error)
  }
}
