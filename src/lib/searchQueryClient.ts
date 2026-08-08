// 検索履歴と登録パターンをサーバから読み書きする (docs/59-検索候補計画.md §7)。
//
// **失敗しても検索は動く**、が全体の方針。候補が出ない・記録が残らないだけで、
// 画面にエラーは出さない (localStorage 版と同じ割り切り)。ただし黙って消えると
// 原因が追えないので、記録だけは console に残す。
//
// 読みはフォーカスしたときの 1 回だけ。候補はドロップダウンを開いて初めて要る
// 値なので、描画のたびに引く必要がない。
//
// 書きは fire-and-forget + 楽観更新。★ を押した手応えを往復待ちにしないため、
// 手元のキャッシュを先に動かして、返ってきた正本で置き換える。

import { applyQueryUse, type QueryLists } from './searchQueries'

const ENDPOINT = '/api/search-queries'
const SAVED_ENDPOINT = '/api/search-queries/saved'

// 直近にサーバから受け取った (または楽観更新した) リスト。
//
// 検索窓を開いた瞬間に前回の値を出すためのもので、正しさの根拠にはしない
// (開くたびに取り直す)。null = まだ一度も読めていない。
let cached: QueryLists | null = null

export function cachedQueries(): QueryLists | null {
  return cached
}

// テスト用。モジュールに溜まった状態を捨てる
export function resetQueryCache(): void {
  cached = null
}

// 応答の検算。**サーバを無条件には信じない** — 型が合わない物を画面へ
// 流すと、候補の描画側で落ちる。配列で・中身が空でない文字列であることを見る。
function parseLists(data: unknown): QueryLists | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const { saved, recent } = data as { saved?: unknown; recent?: unknown }
  if (!Array.isArray(saved) || !Array.isArray(recent)) {
    return null
  }
  const clean = (list: unknown[]) =>
    list.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
  return { saved: clean(saved), recent: clean(recent) }
}

// 口を 1 つ叩いて、返ってきたリストでキャッシュを差し替える。
// 読めなければ null (呼び出し側は「候補なし」として扱う)。
async function callQueryApi(
  url: string,
  init?: { method: string; body: unknown; keepalive?: boolean },
): Promise<QueryLists | null> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init ? { 'Content-Type': 'application/json' } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
      // 遷移の途中で投げる記録があるので、ブラウザに投げ切ってもらう
      keepalive: init?.keepalive ?? false,
      // 履歴は「今どうなっているか」しか意味が無い。中間キャッシュに
      // 持たれると、別の端末で足した分がいつまでも見えない
      cache: 'no-store',
    })
    if (!res.ok) {
      // 409 (登録が満杯) もここに来る。画面は押せなくしてあるので、
      // 通常は起きない = 起きたら知りたい
      console.warn(`searchQueryClient: ${url} が ${res.status} を返した`)
      return null
    }
    const body: unknown = await res.json()
    const lists = parseLists((body as { data?: unknown } | null)?.data)
    if (lists === null) {
      console.warn(`searchQueryClient: ${url} の応答を読めなかった`, body)
      return null
    }
    cached = lists
    return lists
  } catch (e) {
    // 圏外・遷移による中断。候補が出ないだけで検索は動く
    console.warn(`searchQueryClient: ${url} を呼べなかった`, e)
    return null
  }
}

// 検索窓を開いたときに読む。
export async function fetchQueries(): Promise<QueryLists | null> {
  return callQueryApi(ENDPOINT)
}

// クエリを「使った」と記録する (docs/59-検索候補計画.md §2)。
//
// **呼ぶのは「意思表示」のときだけ**。打鍵ごとの検索 (debounce) からは
// 呼ばない — 呼ぶと打ちかけの語で枠が埋まる。
//
// 返事は待たない。結果のノートを開いた瞬間にも呼ばれる (SearchNav) ので、
// 待たせると遷移が遅れる。手元のキャッシュだけ先に進めておく。
export function recordQueryUse(query: string): void {
  const q = query.trim()
  if (q === '') {
    return
  }
  if (cached) {
    cached = applyQueryUse(cached, q)
  }
  // keepalive … 記録の直後にページを離れることが多い (結果を開く・タグを押す)。
  // 付けないとブラウザが遷移で要求を捨てて、記録が残らないことがある
  void callQueryApi(ENDPOINT, { method: 'POST', body: { query: q }, keepalive: true })
}

// ☆ を押して登録する。満杯なら null (サーバが 409 を返す)。
export async function registerSavedQuery(query: string): Promise<QueryLists | null> {
  return callQueryApi(SAVED_ENDPOINT, { method: 'PUT', body: { query } })
}

// ★ を押して外す。サーバ側で履歴へ入れ直されたリストが返る。
export async function unregisterSavedQuery(query: string): Promise<QueryLists | null> {
  return callQueryApi(SAVED_ENDPOINT, { method: 'DELETE', body: { query } })
}

// localStorage に残っていた登録パターンを引き取る。
export async function importSavedQueries(saved: string[]): Promise<QueryLists | null> {
  return callQueryApi(ENDPOINT, { method: 'PUT', body: { saved } })
}
