// 検索窓のキーワード補完 (docs/59-検索候補計画.md §5)。
// `i` まで打つと `is:todo` `is:done` を候補に出す。DB 非依存の純関数で、
// タグ補完 (tagComplete.ts) と同じ形をしている。
//
// この機能の狙いは打鍵数の削減だけではない。`is:` という構文が**あると
// 気づかせる**ことでもあるので、`is` まで打たないと出ない、にはしない。
// 候補が出ている間も `active === -1` なら Enter はそのまま検索送信になるので
// (SearchForm)、出ているだけで入力の邪魔にはならない。

import {
  insideQuote,
  isTokenBoundary,
  type CompleteRange,
} from '@/lib/queryComplete'

// 補完できる検索キーワード。増えてもここへ足すだけで UI は変わらない。
// 検索側の実装は search.ts の parseSearchExpr (docs/56-チェック検索計画.md)。
export const SEARCH_KEYWORDS = ['is:todo', 'is:done'] as const

// キーワードを構成する 1 文字。`:` を含むのが要点 —
// `is:t` まで打った状態を 1 つのトークンとして扱いたい。
const KEYWORD_CHAR = /[A-Za-z:]/

// 補完対象のキーワードを打ちかけている文脈。
export interface KeywordContext extends CompleteRange {
  prefix: string // 小文字化した入力中のトークン (`is:t` など)
}

function isKeywordChar(ch: string | undefined): boolean {
  return ch !== undefined && KEYWORD_CHAR.test(ch)
}

// カーソル位置がキーワードを打ちかけている文脈なら KeywordContext を、
// そうでなければ null。
export function keywordContextAtCursor(
  query: string,
  cursor: number,
): KeywordContext | null {
  if (cursor < 0 || cursor > query.length) return null
  if (insideQuote(query, cursor)) return null

  // カーソルから左へキーワード文字をたどってトークンの先頭を探す。
  let start = cursor
  while (start > 0 && isKeywordChar(query[start - 1])) start--
  if (start === cursor) return null // 空トークン (空白の直後) では出さない
  // 直前が語の境界でなければトークンの途中 — `#tag` の中や `C#is` などは
  // ここで落ちる (`#` はタグ補完の担当)。
  if (!isTokenBoundary(query[start - 1])) return null

  // 置換範囲はカーソル以降の後続文字も含める (語中編集でもトークン全体を置換)。
  let end = cursor
  while (end < query.length && isKeywordChar(query[end])) end++

  return { start, end, prefix: query.slice(start, cursor).toLowerCase() }
}

// prefix に前方一致するキーワードを返す。
// 空のときと既に完全一致しているときは何も返さない — どちらも候補が
// 「今打った物と同じ 1 行」になるだけで、選ぶ意味がないため。
export function matchKeywords(prefix: string): string[] {
  if (!prefix) return []
  return SEARCH_KEYWORDS.filter((kw) => kw !== prefix && kw.startsWith(prefix))
}
