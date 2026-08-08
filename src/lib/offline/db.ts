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
//
// iOS の IndexedDB は歴史的に不安定なので、**ここは捨てて作り直せるキャッシュ**
// として扱う。失敗は握り潰さず投げ、呼び出し側 (sync.ts) が「同期していない」
// 状態へ倒す。

import { parseSyncPayload, type OfflineSyncPayload } from './item'

const DB_NAME = 'qr-search-offline'
const DB_VERSION = 1
const STORE = 'snapshot'
// 1 レコードしか持たないので鍵は固定 (out-of-line key)
const SNAPSHOT_KEY = 'items'

// IDBRequest を Promise にする。IndexedDB は 2010 年代前半の API で
// Promise を返さないため、使うたびに書く定型をここに 1 つだけ置く
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB の要求が失敗しました'))
  })
}

// IndexedDB が使えない環境 (サーバ側の描画、プライベートブラウズの一部) では
// 例外にする。呼び出し側は「オフライン用の保存は無い」として扱う
function openOnce(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('この環境では IndexedDB を使えません'))
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE)
    }
  }
  return promisify(request)
}

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('IndexedDB を削除できませんでした'))
    // blocked … 別タブが同じ DB を開いている。そちらが閉じるまで待つと
    // 固まるので、消せなかったことにして諦める (次の起動でやり直す)
    request.onblocked = () => reject(new Error('IndexedDB が他のタブに使われています'))
  })
}

// **同じ版のまま中身が壊れている場合から立ち直る**のがこの関数の役目。
//
// 版が上がらない限り onupgradeneeded は呼ばれない。ところが「DB はあるのに
// ストアが無い」状態は現実に作れる — 別のコードが版 1 で開いた、途中で
// 失敗した、といった経路である。そのまま返すと transaction が毎回
// NotFoundError で落ち、**再同期しても直らない**行き止まりになる。
//
// ここは捨てて作り直せるキャッシュ (冒頭) なので、迷わず消してから開き直す。
// やり直しは 1 回だけ (それでも駄目なら環境側の問題で、繰り返しても同じ)。
async function openDb(): Promise<IDBDatabase> {
  const db = await openOnce()
  if (db.objectStoreNames.contains(STORE)) {
    return db
  }
  db.close()
  await deleteDb()
  const rebuilt = await openOnce()
  if (!rebuilt.objectStoreNames.contains(STORE)) {
    rebuilt.close()
    throw new Error('IndexedDB を作り直せませんでした')
  }
  return rebuilt
}

// トランザクションを 1 つ張って処理を通す。
//
// **complete を待つ**のが要点。put の onsuccess はトランザクションの確定より
// 前に来るので、そこで解決すると「保存できた」と言った直後に落ちて中身が
// 無い、が起こりうる
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB のトランザクションが失敗しました'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB のトランザクションが中断されました'))
    })
    const result = await run(tx.objectStore(STORE))
    await done
    return result
  } finally {
    // 開きっぱなしにすると、別タブが版を上げるときに blocked で止まる
    db.close()
  }
}

export async function saveOfflineSnapshot(payload: OfflineSyncPayload): Promise<void> {
  await withStore('readwrite', (store) => promisify(store.put(payload, SNAPSHOT_KEY)))
}

// 保存が無ければ null。壊れていた (形が違う) ときも null にして、呼び出し側は
// 「まだ同期していない」と同じ扱いにする — 直す手立ては再同期しかないため
export async function loadOfflineSnapshot(): Promise<OfflineSyncPayload | null> {
  const stored = await withStore('readonly', (store) =>
    promisify<unknown>(store.get(SNAPSHOT_KEY)),
  )
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
  await withStore('readwrite', (store) => promisify(store.delete(SNAPSHOT_KEY)))
}

// Service Worker が持つ棚の名前の頭 (sw.js の SHELL_CACHE / MEDIA_CACHE と対)。
// 版ごとに名前が変わるので、前方一致でまとめて掃く
const CACHE_PREFIX = 'qr-'

// ログアウトで端末から持ち出し分を消す。
//
// 消す先は 2 つある。**IndexedDB だけでは足りない**:
//   IndexedDB … ノート本文・タグ・URL (一覧と検索の中身そのもの)
//   Cache Storage … 添付のサムネと原寸 (/api/images/)。sw.js は
//     キャッシュから返すとき認証を見ないので、残すと画像だけ読めてしまう
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
