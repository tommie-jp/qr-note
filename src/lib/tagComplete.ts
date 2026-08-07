// 検索窓のタグ補完ロジック (DB 非依存の純関数)。
// カーソル位置のトークンが `#○○` を打ちかけているときだけ発動し、
// 候補の絞り込み・共通プレフィックス・置換を担う。UI (SearchForm) は薄く保つ。
//
// bash 流の操作を想定:
//   - `#t` まで打つと `#tag1` `#tag2` … が候補に出る
//   - Tab で最長共通プレフィックスまで補完 (一意なら確定 + スペース)
//   - 候補選択 (↓/↑ + Enter, クリック) で確定

import {
  insideQuote,
  isTokenBoundary,
  replaceRange,
  type CompleteRange,
  type Completion,
} from '@/lib/queryComplete'
import { normalizeTag } from '@/lib/tags'

export type { Completion }

// タグ名に使える 1 文字 (tags.ts の TAG_INNER と一致させる)。
const TAG_CHAR = /[\p{L}\p{N}\p{M}_-]/u
const TAG_MARKER = /[#＃]/

// 補完対象のタグを打ちかけている文脈。
// start は `#`/`＃` マーカーの位置 (置換の開始)、end は置換の終端
// (カーソル + 後続タグ文字)。
export interface TagContext extends CompleteRange {
  prefix: string // 正規化済みの入力中プレフィックス (# を含まない)
}

function isTagChar(ch: string | undefined): boolean {
  return ch !== undefined && TAG_CHAR.test(ch)
}

// カーソル位置がタグを打ちかけている文脈なら TagContext を、そうでなければ null。
export function tagContextAtCursor(query: string, cursor: number): TagContext | null {
  if (cursor < 0 || cursor > query.length) return null
  if (insideQuote(query, cursor)) return null

  // カーソルから左へタグ文字をたどり、マーカー `#`/`＃` を探す。
  let i = cursor
  while (i > 0 && isTagChar(query[i - 1])) i--
  const markerPos = i - 1
  if (markerPos < 0 || !TAG_MARKER.test(query[markerPos])) return null
  // マーカー直前が「行頭・空白・演算子」ならタグの開始とみなす
  // (C# のような語中の # を除外する)。メモ本文のタグ抽出 (tags.ts) は空白
  // 区切りだけで、こちらより狭いことに注意 — 本文の `C#` を拾わないため。
  // 検索窓には演算子があるので条件が違う。
  if (!isTokenBoundary(query[markerPos - 1])) return null

  // 置換範囲はカーソル以降の後続タグ文字も含める (語中編集でもタグ全体を置換)。
  let end = cursor
  while (end < query.length && isTagChar(query[end])) end++

  const prefix = normalizeTag(query.slice(markerPos + 1, cursor))
  return { start: markerPos, end, prefix }
}

// prefix に前方一致するタグを返す (tags の並び順を維持し、上限まで)。
// prefix が空なら全タグの先頭 limit 件 (`#` 単独で人気タグを一覧)。
export function matchTags(prefix: string, tags: string[], limit = 8): string[] {
  const matched = prefix
    ? tags.filter((tag) => tag.startsWith(prefix))
    : tags
  return matched.slice(0, limit)
}

// 候補群の最長共通プレフィックス (Tab 補完用)。
export function longestCommonPrefix(names: string[]): string {
  if (names.length === 0) return ''
  let prefix = names[0]
  for (const name of names.slice(1)) {
    let i = 0
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++
    prefix = prefix.slice(0, i)
    if (prefix === '') break
  }
  return prefix
}

// ctx の範囲を `#tagName` に置換する。addSpace 時は末尾へスペースを補って
// 次の語に移りやすくする (直後が既に空白なら足さない)。
export function applyCompletion(
  query: string,
  ctx: TagContext,
  tagName: string,
  opts: { addSpace?: boolean } = {},
): Completion {
  return replaceRange(query, ctx, `#${tagName}`, opts)
}
