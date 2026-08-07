// 検索窓が覚えているクエリ (docs/59-検索候補計画.md §2-4)。2 種類ある。
//
//   最近の検索   … 直近に検索した語。使うほど勝手に入れ替わる。
//   登録パターン … ☆ で自分が登録した検索式。数が少なく、自分で選んで置いた物。
//
// **localStorage に置く**。検索のたびに DB へ書くのは重すぎるし、最近の検索は
// 端末ごとに違ってよい (スマホでは部品番号、PC では調べ物、という差がそのまま
// 出るのが自然)。並び順 (sortMode.ts) や表示モード (viewMode.ts) が cookie なのは
// サーバが描画前に読む必要があるからで、候補はフォーカスして初めて要る値なので
// その理由が無い。
//
// 読み出しは信用しない — 手で書き換えられる値なので、配列であること・中身が
// 空でない文字列であることを検算してから使う (drawPrefs.ts と同じ作法)。

// localStorage のうち、ここで使う分だけの形。テストから差し替えられるように
// 具象の Storage ではなくこの幅で受ける。
export interface QueryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const RECENT_KEY = 'qr-search-recent'
export const SAVED_KEY = 'qr-search-saved'

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

// 保存済みの一覧。**読めなかったときは null** を返す。
//
// 「まだ何も保存していない」(= []) と区別が要るのは、書き込みが読んだ値への
// 追加・削除だから — 壊れた値を [] と読んで書き戻すと、利用者が登録した
// パターンを 1 クリックで消してしまう。書き手 (recordQueryUse / UI) は
// null なら書かずに諦める。
export function readQueries(
  storage: QueryStorage | null | undefined,
  key: string,
): string[] | null {
  if (!storage) {
    return null
  }
  try {
    const raw = storage.getItem(key)
    if (!raw) {
      return [] // 未保存。ここへ書き足すのは正しい
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn(`searchQueries: ${key} が配列ではない`, raw)
      return null
    }
    return parsed
      .filter((e): e is string => typeof e === 'string' && e.trim() !== '')
      .slice(0, QUERY_LIMIT)
  } catch (e) {
    // 壊れた JSON、プライベートモードの拒否。候補が出ないだけで検索は動くが、
    // 黙って消えると原因が追えないので記録だけ残す
    console.warn(`searchQueries: ${key} を読めなかった`, e)
    return null
  }
}

// 表示のための読み出し。読めなければ「候補なし」として扱う。
export function loadQueries(
  storage: QueryStorage | null | undefined,
  key: string,
): string[] {
  return readQueries(storage, key) ?? []
}

export function saveQueries(
  storage: QueryStorage | null | undefined,
  key: string,
  list: readonly string[],
): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(key, JSON.stringify(list))
  } catch (e) {
    // 容量超過・プライベートモード。覚えられないだけで検索には影響しないが、
    // 「覚えたつもりが消えている」の原因になるので記録は残す
    console.warn(`searchQueries: ${key} へ書けなかった`, e)
  }
}

// ブラウザの localStorage。サーバ描画中と、参照そのものが例外になる設定
// (一部のプライベートモード) では null を返す。
export function browserQueryStorage(): QueryStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

// クエリを「使った」と記録する。読み書きをまとめた唯一の入口で、
// 検索窓 (SearchForm) と結果一覧 (SearchNav) の両方から呼ばれる。
//
// **呼ぶのは「意思表示」のときだけ** (docs/59-検索候補計画.md §2)。
// 打鍵ごとの検索 (debounce) からは呼ばない — 呼ぶと打ちかけの語で枠が埋まる。
//
// 登録パターンなら最近使った順の先頭へ動かすだけで、最近の検索には足さない。
// 足すと ★ の欄に出ている物が 🕐 の枠を見えないまま食う (表示では登録済みを
// 引くので、履歴が 10 件のうち何件かは常に空振りになる)。
export function recordQueryUse(
  query: string,
  storage: QueryStorage | null = browserQueryStorage(),
): void {
  const q = query.trim()
  if (!storage || q === '') {
    return
  }
  // 読めないときは「登録パターンではない」として扱う。判らないまま履歴まで
  // 諦めるより、履歴には残るほうがまし
  const saved = readQueries(storage, SAVED_KEY)
  if (saved?.includes(q)) {
    saveQueries(storage, SAVED_KEY, touchSavedQuery(saved, q))
    return
  }
  const recent = readQueries(storage, RECENT_KEY)
  if (recent === null) {
    return // 読めない物へ書き戻さない (readQueries 参照)
  }
  saveQueries(storage, RECENT_KEY, addRecentQuery(recent, q))
}
