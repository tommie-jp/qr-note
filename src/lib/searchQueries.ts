// 検索窓が覚えているクエリ (docs/59-検索候補計画.md §2-4)。2 種類ある。
//
//   最近の検索   … 直近に検索した語。使うほど勝手に入れ替わる。
//   登録パターン … ☆ で自分が登録した検索式。並びは動かない。
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

// ドロップダウンに出す件数 (種類ごと)。合わせて 6 行 = 画面を覆わない上限。
export const SUGGEST_COUNT = 3

// 最近の検索を覚えておく上限。出すのは先頭 3 件だけだが、それより深く持つのは
// 前方一致の掃除 (addRecentQuery) を効かせるため — 3 件しか持たないと掃除する
// 前に押し出されて、残骸が消えずに枠を食い続ける。
export const QUERY_LIMIT = 20

// 登録パターンの上限。**出す件数とわざと同じにする**。持てる数を表示数より
// 多くすると「登録したのに ★ の欄に出ない・外す導線も無い」パターンが生まれ、
// 消せないまま枠を食う。全部見えていれば ★ を押して必ず外せる。
export const SAVED_LIMIT = SUGGEST_COUNT

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

// 登録パターンへ 1 件足す。**末尾へ足す** — パターンは並びが動かないから
// 筋肉記憶が効く、というのが最近の検索との違いなので、既存の並びは崩さない。
// 満杯のときは何もしない (UI 側は ☆ を押せなくして理由を出す)。
export function addSavedQuery(list: readonly string[], query: string): string[] {
  const q = query.trim()
  if (!q || list.includes(q) || list.length >= SAVED_LIMIT) {
    return [...list]
  }
  return [...list, q]
}

export function isSavedFull(list: readonly string[]): boolean {
  return list.length >= SAVED_LIMIT
}

export function removeSavedQuery(list: readonly string[], query: string): string[] {
  return list.filter((e) => e !== query)
}

// ドロップダウンに出す 2 組を決める。
//
// 登録パターンはよく使う = 最近の検索にも必ず入るので、掃除しないと 6 行の
// うち 3 行が同じ物になる。登録パターンは**全部出す** (SAVED_LIMIT が表示数と
// 同じなので隠れる物がない) ので、「★ の欄に居る = 登録済み」が常に成り立ち、
// 🕐 の行の ☆ は必ず未登録を意味する。
export function splitSuggestions(
  saved: readonly string[],
  recent: readonly string[],
): { saved: string[]; recent: string[] } {
  return {
    saved: [...saved],
    recent: recent.filter((q) => !saved.includes(q)).slice(0, SUGGEST_COUNT),
  }
}

// 保存済みの一覧。**読めなかったときは null** を返す。
//
// 「まだ何も保存していない」(= []) と区別が要るのは、書き込みが読んだ値への
// 追加・削除だから — 壊れた値を [] と読んで書き戻すと、利用者が登録した
// パターンを 1 クリックで消してしまう。書き手 (recordRecentQuery / UI) は
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

// 最近の検索へ 1 件記録する。読み書きの 3 手をまとめた唯一の入口で、
// 検索窓 (SearchForm) と結果一覧 (SearchNav) の両方から呼ばれる。
//
// **呼ぶのは「意思表示」のときだけ** (docs/59-検索候補計画.md §2)。
// 打鍵ごとの検索 (debounce) からは呼ばない — 呼ぶと打ちかけの語で枠が埋まる。
export function recordRecentQuery(
  query: string,
  storage: QueryStorage | null = browserQueryStorage(),
): void {
  if (!storage || query.trim() === '') {
    return
  }
  const list = readQueries(storage, RECENT_KEY)
  if (list === null) {
    return // 読めない物へ書き戻さない (readQueries 参照)
  }
  saveQueries(storage, RECENT_KEY, addRecentQuery(list, query))
}
