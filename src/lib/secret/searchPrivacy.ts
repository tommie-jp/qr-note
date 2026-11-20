// シークレット内検索の間、検索語を「残さない」ための印 (docs/130 §6)。
//
// 断片の中身を探す語は、口座番号のような秘密そのものになりやすい。トグルが
// 入っている間に探した語は、
//
//   - 検索履歴 (search/queryClient.ts → search_queries) に送らない
//   - 端末の一覧の控え (client/listPersist.ts → IndexedDB に 30 日) に書かない
//
// **真偽と語の集合だけを持つ葉にしてある。** 読むのは検索履歴・一覧の控えという
// どの画面にも入る部品で、ここが解錠の手順 (secret/searchSession.ts → unlock・
// prf・keyring) を import すると、その一式が全画面の束に入ってしまう。
// 状態の正本は searchSession で、あちらが変わるたびにここへ写す。

import { createNotifier } from '../prefs/externalStore'

let isActive = false

// searchSession だけが呼ぶ。読み込み中も「入っている」に数える —
// 入れた直後に打った語を残さないため
export function setSecretSearchActive(next: boolean): void {
  isActive = next
}

export function isSecretSearchOn(): boolean {
  return isActive
}

// --- 書き込みの後の取り直しの合図 (docs/131 §6) ---
//
// シークレット側のノートは ON にしたときの写しなので、ノートを消す・タグを
// 付ける・断片を編集した後は古い行が残る。書き込みの後始末 (client/invalidate.ts)
// がここへ合図を出し、searchSession が入っている間だけ取り直す。
// **合図の口をこの葉に置く**のは、invalidate.ts がどの画面にも入る部品だから
// (searchSession を直に import させない。冒頭の理由と同じ)
const reloadNotifier = createNotifier()

export function requestSecretSearchReload(): void {
  if (isActive) {
    reloadNotifier.notify()
  }
}

export function subscribeSecretSearchReload(listener: () => void): () => void {
  return reloadNotifier.subscribe(listener)
}

// 覚えるのはタブのメモリだけ。再読み込みで消えるが、そのときは一覧の控え
// (メモリ) も消えているので、書かれる機会はもう無い。**トグルを切っても
// 消さない** — 切った直後に、その語の一覧が控えへ書かれてしまう
const secretQueries = new Set<string>()
const notifier = createNotifier()

// 検索画面が「いまの検索語」を知らせる。トグルが切れていれば何もしない
export function markSecretSearchedQuery(query: string): void {
  const q = query.trim()
  if (q === '' || !isActive || secretQueries.has(q)) {
    return
  }
  secretQueries.add(q)
  notifier.notify()
}

export function isSecretSearchedQuery(query: string): boolean {
  return secretQueries.has(query.trim())
}

// 語が増えたときに呼ばれる。既に端末へ書いた控えを書き直すために使う
export function subscribeSecretSearchedQueries(listener: () => void): () => void {
  return notifier.subscribe(listener)
}
