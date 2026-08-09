// 持ち出したノートの置き場 (docs/65-オフライン対応計画.md §3-2)。
//
// **1 レコードにまるごと入れる**のが設計の要点。ノート 1 件ずつを別レコードに
// 分けたくなるが、検索は毎回全件を舐めるので取り出すのは常に「全部」であり、
// 分けても得がない。1 レコードなら書き込みが 1 トランザクションで完結し、
// 途中で落ちても「古いまま」か「新しい」かのどちらかにしかならない
// (半分だけ新しい状態が作れない)。
//
// 保存した物は**外部入力として読み直す** (memoDraft.ts と同じ流儀)。古い版の
// アプリが書いた形が残っていることがあるので、parseSyncPayload を通してから使う。
//
// localStorage ではなく IndexedDB にするのは容量 (localStorage は 5MB 前後で、
// 本文をすべて置くと将来詰まる) と、同期 API を待たずに読める非同期性のため。
// IndexedDB そのものの配管は idb.ts が持つ。

import { deleteRecord, getRecord, putRecord } from './idb'
import { parseSyncPayload, type OfflineSyncPayload } from './item'
import { clearKeyringCache } from './keyring'

// 1 レコードしか持たないので鍵は固定 (out-of-line key)
const SNAPSHOT_KEY = 'items'

export async function saveOfflineSnapshot(payload: OfflineSyncPayload): Promise<void> {
  await putRecord('snapshot', SNAPSHOT_KEY, payload)
}

// 保存が無ければ null。壊れていた (形が違う) ときも null にして、呼び出し側は
// 「まだ同期していない」と同じ扱いにする — 直す手立ては再同期しかないため
export async function loadOfflineSnapshot(): Promise<OfflineSyncPayload | null> {
  const stored = await getRecord('snapshot', SNAPSHOT_KEY)
  return stored === undefined ? null : parseSyncPayload(stored)
}

// ログアウト時に消す。端末に残った本文は Cache Storage / IndexedDB のどちらも
// 平文なので、少なくとも「ログアウトしたのに読める」状態は作らない。
//
// **これを呼ばないとログアウトが穴になる。** /offline はログイン不要で開ける
// ようにしてある (publicPaths.ts) ので、消さずに残すと「ログアウトしたのに
// 端末を触れば全ノートを読めて検索もできる」状態になる。呼び出しは
// LogoutButton (clearOfflineData) が持つ。
export async function clearOfflineSnapshot(): Promise<void> {
  await deleteRecord('snapshot', SNAPSHOT_KEY)
}

// Service Worker が持つ棚の名前の頭 (sw.js の SHELL_CACHE / MEDIA_CACHE と対)。
// 版ごとに名前が変わるので、前方一致でまとめて掃く
const CACHE_PREFIX = 'qr-'

// ログアウトで端末から持ち出し分を消す。
//
// 消す先は 3 つある。**IndexedDB のノートだけでは足りない**:
//   snapshot (IndexedDB) … ノート本文・タグ・URL (一覧と検索の中身そのもの)
//   keyring  (IndexedDB) … シークレットの鍵束の写し (keyring.ts)。中身は
//     包んだ鍵なので単体では読めないが、ログアウトした端末に残す理由が無い
//   Cache Storage … 添付のサムネと原寸 (/api/images/)、印付きノートの持ち出し
//     (qr-pin-v1)、シークレットの暗号文 (qr-secret-v1)。sw.js はキャッシュから
//     返すとき認証を見ないので、残すと画像だけ読めてしまう
//
// 殻 (qr-shell-*) も消す。中身にノートは無いが、ログイン中に描いた HTML
// なのでヘッダにユーザー名が焼き付いている。次のログインで暖機し直せばよい。
//
// **失敗しても投げない。** ここで投げるとログアウト自体が止まり、
// 「消せなかった上にセッションも残る」という一番悪い結果になる。
// 消せなかったことは console に残す。
export async function clearOfflineData(): Promise<void> {
  try {
    await clearOfflineSnapshot()
  } catch (error) {
    console.warn('オフライン用のノートを消せませんでした', error)
  }
  try {
    await clearKeyringCache()
  } catch (error) {
    console.warn('オフライン用の鍵束を消せませんでした', error)
  }
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
      )
    }
  } catch (error) {
    console.warn('オフライン用の添付を消せませんでした', error)
  }
}
