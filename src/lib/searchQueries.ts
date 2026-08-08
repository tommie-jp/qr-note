// 検索窓が覚えているクエリ (docs/59-検索候補計画.md §2-4, §7)。2 種類ある。
//
//   最近の検索   … 直近に検索した語。使うほど勝手に入れ替わる。
//   登録パターン … ☆ で自分が登録した検索式。数が少なく、自分で選んで置いた物。
//
// **置き場はサーバ (DB)**。もとは localStorage に置き「最近の検索は端末ごとに
// 違ってよい」と考えていたが、実際には同じ人が iPhone と PC を行き来するので、
// 片方で登録したパターンがもう片方に無いのが不便だった。書き込みの契機は
// 「意思表示」のときだけ (打鍵ごとの検索からは呼ばない) なので、DB に置いても
// 書き込み頻度は高くない。
//
// **このファイルは純粋な計算だけ**を持つ。読み書きは 2 か所に分かれる:
//
//   searchQueryStore.ts  … サーバ側。userName で仕切って DB へ (正本)
//   searchQueryClient.ts … クライアント側。/api/search-queries を叩く
//
// 並びの意味づけ (前方一致の掃除・上限・登録が履歴より強い) をここ 1 か所に
// 置くことで、サーバの書き込みとクライアントの楽観更新が食い違わない。

// 覚えている 2 つのリスト。どちらも**最近使った順** (先頭が最新)。
export interface QueryLists {
  saved: string[]
  recent: string[]
}

// 最初にドロップダウンへ出す件数 (種類ごと)。合わせて 10 行 = 画面を覆わない上限。
// これを超える分は「もっと表示」を押したときだけ出す。
export const SUGGEST_COUNT = 5

// 最近の検索を覚えておく上限。
export const QUERY_LIMIT = 10

// 登録パターンの上限。
//
// **持てる数を「もっと表示」で出し切れる数に収める**のが要点。出し切れないと
// 「登録したのに ★ の欄に出ない・外す導線も無い」パターンが生まれ、消せないまま
// 枠を食う。上限まで広げれば必ず画面に出せるので、★ を押して必ず外せる。
export const SAVED_LIMIT = 10

// 1 件の長さの上限。検索窓に貼り付けた長文をそのまま溜め込まないための歯止めで、
// 実用的な検索式 (タグ数個 + 語) には十分な幅。外から来る値なので、
// サーバ側の入口 (route) でもこの値で断る。
export const MAX_QUERY_LENGTH = 200

// 最近の検索へ 1 件足す (先頭が最新)。
//
// 前方一致になっている古い記録は消す。この検索窓は打ちながら検索するので
// (SearchForm の debounce)、記録の契機を絞ってもなお「電」「電験」といった
// 打ちかけが混ざりうるため。逆は消さない — 長い語を覚えている状態で短く
// 検索し直すのは、それ自体が新しい検索だから。
export function addRecentQuery(list: readonly string[], query: string): string[] {
  const q = query.trim()
  if (!q) {
    return [...list]
  }
  return [q, ...list.filter((e) => !q.startsWith(e))].slice(0, QUERY_LIMIT)
}

// 登録パターンへ 1 件足す。**先頭へ足す** — 登録パターンも最近使った順に
// 並べる (docs/59-検索候補計画.md §4) ので、登録した = 今使ったばかり、が
// いちばん上に来る。満杯のときは何もしない (UI 側は ☆ を押せなくして理由を
// 出す)。古い物を押し出さないのは、消えるのが登録した覚えのある物だから。
export function addSavedQuery(list: readonly string[], query: string): string[] {
  const q = query.trim()
  if (!q || list.includes(q) || list.length >= SAVED_LIMIT) {
    return [...list]
  }
  return [q, ...list]
}

// 使った登録パターンを先頭へ動かす (最近使った順)。登録されていなければ何もしない。
export function touchSavedQuery(list: readonly string[], query: string): string[] {
  const q = query.trim()
  if (!list.includes(q)) {
    return [...list]
  }
  return [q, ...list.filter((e) => e !== q)]
}

export function isSavedFull(list: readonly string[]): boolean {
  return list.length >= SAVED_LIMIT
}

export function removeSavedQuery(list: readonly string[], query: string): string[] {
  return list.filter((e) => e !== query)
}

// クエリを「使った」を 2 つのリストへ反映する (docs/59-検索候補計画.md §2)。
//
// **記録の意味づけの正本**。サーバの書き込み (searchQueryStore) とクライアントの
// 楽観更新 (searchQueryClient) が同じ答えを出すよう、両方がこれを通る。
//
// 登録パターンなら最近使った順の先頭へ動かすだけで、最近の検索には足さない。
// 足すと ★ の欄に出ている物が 🕐 の枠を見えないまま食う (表示では登録済みを
// 引くので、履歴が 10 件のうち何件かは常に空振りになる)。
export function applyQueryUse(lists: QueryLists, query: string): QueryLists {
  const q = query.trim()
  if (!q) {
    return cloneLists(lists)
  }
  if (lists.saved.includes(q)) {
    return { saved: touchSavedQuery(lists.saved, q), recent: [...lists.recent] }
  }
  return { saved: [...lists.saved], recent: addRecentQuery(lists.recent, q) }
}

export function cloneLists(lists: QueryLists): QueryLists {
  return { saved: [...lists.saved], recent: [...lists.recent] }
}

// ドロップダウンに出す 2 組を決める。expanded は「もっと表示」を押した後。
//
// 登録パターンはよく使う = 最近の検索にも必ず入るので、掃除しないと同じ物が
// 2 度並ぶ。**隠れている分も含めた登録パターン全部**を最近から引くのが要点で、
// これで「🕐 の行は必ず未登録」が畳んでいる間も成り立つ (☆ が空振りしない)。
//
// hasMore … まだ出していない候補があるか。畳んでいるときだけ立つ。
export function splitSuggestions(
  saved: readonly string[],
  recent: readonly string[],
  expanded = false,
): { saved: string[]; recent: string[]; hasMore: boolean } {
  const fresh = recent.filter((q) => !saved.includes(q))
  if (expanded) {
    return { saved: [...saved], recent: fresh, hasMore: false }
  }
  return {
    saved: saved.slice(0, SUGGEST_COUNT),
    recent: fresh.slice(0, SUGGEST_COUNT),
    hasMore: saved.length > SUGGEST_COUNT || fresh.length > SUGGEST_COUNT,
  }
}

// 覚えるに値するクエリか。空・長すぎ・文字列でない物を断る。
//
// **外から来た値はここを必ず通す**。route (他人が直接叩ける口) と
// クライアント (localStorage から移した値) の両方が使う。
export function isRecordableQuery(query: unknown): query is string {
  return (
    typeof query === 'string' &&
    query.trim() !== '' &&
    query.trim().length <= MAX_QUERY_LENGTH
  )
}

// 外から受け取ったクエリの配列を、覚えられる形だけに絞る。
// 重複は先に出てきたほうを残す (順が意味を持つため)。
export function sanitizeQueryList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of value) {
    if (!isRecordableQuery(e)) {
      continue
    }
    const q = e.trim()
    if (seen.has(q)) {
      continue
    }
    seen.add(q)
    out.push(q)
  }
  return out
}
