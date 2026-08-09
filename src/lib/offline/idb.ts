// オフライン用 IndexedDB の配管 (docs/65-オフライン対応計画.md §3-2)。
//
// 置き場は 2 つある。**同じ DB に別ストアとして持つ**のは、ログアウトで
// まとめて消す先が 1 つで済むため (別 DB にすると片方の消し忘れが穴になる):
//
//   snapshot … 持ち出したノート (db.ts)
//   keyring  … シークレットの鍵束の写し (keyring.ts)
//
// どちらも**捨てて作り直せるキャッシュ**として扱う。iOS の IndexedDB は
// 歴史的に不安定なので、壊れていたら消してやり直す (openDb)。失敗は握り潰さず
// 投げ、呼び出し側が「保存が無い」状態へ倒す。

const DB_NAME = 'qr-search-offline'
// 2: keyring ストアを足した (シークレットのオフライン解錠)
const DB_VERSION = 2

// この DB が持つストア。**追加したら DB_VERSION を上げること** —
// 上げないと onupgradeneeded が呼ばれず、openDb が毎回 DB を消して
// 作り直す羽目になる (ノートの同期が起動のたびに巻き戻る)
export const OFFLINE_STORES = ['snapshot', 'keyring'] as const

export type OfflineStore = (typeof OFFLINE_STORES)[number]

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
    for (const store of OFFLINE_STORES) {
      if (!request.result.objectStoreNames.contains(store)) {
        request.result.createObjectStore(store)
      }
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

function hasAllStores(db: IDBDatabase): boolean {
  return OFFLINE_STORES.every((store) => db.objectStoreNames.contains(store))
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
  if (hasAllStores(db)) {
    return db
  }
  db.close()
  await deleteDb()
  const rebuilt = await openOnce()
  if (!hasAllStores(rebuilt)) {
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
  name: OfflineStore,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction(name, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB のトランザクションが失敗しました'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB のトランザクションが中断されました'))
    })
    const result = await run(tx.objectStore(name))
    await done
    return result
  } finally {
    // 開きっぱなしにすると、別タブが版を上げるときに blocked で止まる
    db.close()
  }
}

// 保存が無ければ undefined。**読み直した値は外部入力として検算すること**
// (memoDraft.ts と同じ流儀) — 古い版のアプリが書いた形が残っていることがある
export function getRecord(name: OfflineStore, key: string): Promise<unknown> {
  return withStore(name, 'readonly', (store) => promisify<unknown>(store.get(key)))
}

export async function putRecord(
  name: OfflineStore,
  key: string,
  value: unknown,
): Promise<void> {
  await withStore(name, 'readwrite', (store) => promisify(store.put(value, key)))
}

export async function deleteRecord(name: OfflineStore, key: string): Promise<void> {
  await withStore(name, 'readwrite', (store) => promisify(store.delete(key)))
}
