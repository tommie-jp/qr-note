// 検索窓の候補ドロップダウン (docs/59-検索候補計画.md §1) の型と、何を出すかの判断。
// state も DOM も持たない純関数だけを置く。開閉の state は
// components/search/useSuggestDropdown.ts、描画は components/search/SuggestionList.tsx。
//
// 出す候補は 4 種類あって、混ざることはない:
//
//   窓が空          … 登録パターン (★) → 最近の検索 (🕐)
//   `#…` を打ちかけ … タグ候補
//   その他の語      … キーワード候補 (is:todo / is:done)

import { keywordContextAtCursor, matchKeywords } from '@/lib/search/keywordComplete'
import {
  replaceRange,
  type CompleteRange,
  type Completion,
} from '@/lib/search/queryComplete'
import {
  addSavedQuery,
  applyQueryUse,
  isSavedFull,
  removeSavedQuery,
  splitSuggestions,
  type QueryLists,
} from '@/lib/search/queries'
import {
  longestCommonPrefix,
  matchTags,
  tagContextAtCursor,
} from '@/lib/search/tagComplete'

// ドロップダウンに並ぶ 1 行 (docs/59-検索候補計画.md §1)。
//
//   tag / keyword … 打ちかけのトークンを置き換える (続きの補完)
//   saved / recent … クエリ全体を差し替える (打ちかけの語は捨てる)
export type SuggestKind = 'tag' | 'keyword' | 'saved' | 'recent'

export interface Suggestion {
  kind: SuggestKind
  // tag はタグ名 (# を含まない)、他は挿入する文字列そのもの
  value: string
}

// 一覧 (パターン + 最近の検索) を出しているときだけ持つ状態。
export interface ListState {
  expanded: boolean // 「もっと表示」を押した後か
  hasMore: boolean // まだ出していない候補があるか
  // 登録が上限に達しているか。**出ている ★ の数では判断できない** —
  // 畳んでいる間は登録済みでも隠れている物があるため
  savedFull: boolean
}

export interface Dropdown {
  // 補完中のトークン。パターン・最近の検索を並べているときは null。
  // 候補は「補完だけ」か「一覧だけ」のどちらかで、混ざることはない
  token: { range: CompleteRange; typed: string } | null
  list: ListState | null // token と裏表 (どちらか一方だけが非 null)
  items: Suggestion[]
  active: number // -1 = 未選択 (この間は Enter で検索送信)
}

export const MAX_CANDIDATES = 8

// 候補として実際に挿入する文字列。タグだけ `#` が要る
export function insertTextOf(s: Suggestion): string {
  return s.kind === 'tag' ? `#${s.value}` : s.value
}

// 登録パターンと最近の検索を並べたドロップダウン (窓が空のとき)。
//
// まだ読めていない (null) なら出さない — 空の枠を出すより何も出さないほうがよい
export function listDropdown(
  source: QueryLists | null,
  expanded = false,
): Dropdown | null {
  if (source === null) {
    return null
  }
  const shown = splitSuggestions(source.saved, source.recent, expanded)
  const items: Suggestion[] = [
    ...shown.saved.map((value): Suggestion => ({ kind: 'saved', value })),
    ...shown.recent.map((value): Suggestion => ({ kind: 'recent', value })),
  ]
  if (items.length === 0) {
    return null
  }
  return {
    token: null,
    list: {
      expanded,
      hasMore: shown.hasMore,
      savedFull: isSavedFull(source.saved),
    },
    items,
    active: -1,
  }
}

// 現在の値とキャレット位置から出すべき候補を決める (docs/59 §1)。
// タグ → キーワード → (空欄なら) 一覧 の順に見る。
export function suggestDropdown(
  value: string,
  caret: number,
  tags: string[],
  lists: QueryLists | null,
): Dropdown | null {
  const tagCtx = tagContextAtCursor(value, caret)
  if (tagCtx) {
    const names = matchTags(tagCtx.prefix, tags, MAX_CANDIDATES)
    // 打ち終わったタグ 1 つだけが残る形 (`#抵抗` に対して候補も「抵抗」) では
    // 出さない。選んでも何も変わらないのに結果を覆うだけで、窓へフォーカス
    // するたびに出てくる。matchTags 側で落とさないのは、`#ab` に対する
    // 候補が [ab, abc] のとき Tab が `#abc` まで走ってしまうため
    const settled = names.length === 1 && names[0] === tagCtx.prefix
    return names.length > 0 && !settled
      ? {
          token: { range: tagCtx, typed: `#${tagCtx.prefix}` },
          list: null,
          items: names.map((name) => ({ kind: 'tag', value: name })),
          active: -1,
        }
      : null
  }

  const kwCtx = keywordContextAtCursor(value, caret)
  if (kwCtx) {
    const keywords = matchKeywords(kwCtx.prefix)
    return keywords.length > 0
      ? {
          token: { range: kwCtx, typed: kwCtx.prefix },
          list: null,
          items: keywords.map((keyword) => ({ kind: 'keyword', value: keyword })),
          active: -1,
        }
      : null
  }

  return value.trim() === '' ? listDropdown(lists) : null
}

// ↑↓ で選択を 1 つ動かす。端で反対側へ回り込む。
// ↑ は未選択 (-1) からも末尾へ飛ぶ
export function moveActive(dd: Dropdown, step: 1 | -1): Dropdown {
  const { active, items } = dd
  const next =
    step === 1
      ? (active + 1) % items.length
      : active <= 0
        ? items.length - 1
        : active - 1
  return { ...dd, active: next }
}

// Tab を押したときにすること。
//
//   ignore … 一覧を出している (伸ばす先がない)。Tab 本来のフォーカス移動に任せる
//   accept … 候補が 1 つだけ。それで確定する
//   extend … 候補の最長共通プレフィックスまで打ちかけの語を伸ばす
//   stay   … 伸ばせる所まで既に打ってある。Tab は食うが何もしない
export type TabAction =
  | { kind: 'ignore' }
  | { kind: 'accept'; suggestion: Suggestion }
  | { kind: 'extend'; completion: Completion }
  | { kind: 'stay' }

// bash 流: 一意なら確定、複数なら最長共通プレフィックスまで伸ばす。
// 打ちかけのトークンがある補完のときだけ (一覧では伸ばす先がない)
export function tabAction(query: string, dd: Dropdown): TabAction {
  const { token, items } = dd
  if (!token) {
    return { kind: 'ignore' }
  }
  if (items.length === 1) {
    return { kind: 'accept', suggestion: items[0] }
  }
  const lcp = longestCommonPrefix(items.map(insertTextOf))
  if (lcp.length > token.typed.length) {
    return { kind: 'extend', completion: replaceRange(query, token.range, lcp) }
  }
  return { kind: 'stay' }
}

// ☆/★ を押した後のリスト (docs/59-検索候補計画.md §4)。
//
// 外した行はその場で 🕐 に変わるので、履歴にも実際に入れておく。
// 入れないと「閉じて開いたら消えていた」になる (登録パターンとして
// 使っていた間は履歴へ足していないため)。サーバも同じことをする
// (searchQueryStore の unregisterSaved) ので、手元と答えが揃う
export function toggleSavedLists(lists: QueryLists, s: Suggestion): QueryLists {
  return s.kind === 'saved'
    ? applyQueryUse(
        { saved: removeSavedQuery(lists.saved, s.value), recent: lists.recent },
        s.value,
      )
    : { saved: addSavedQuery(lists.saved, s.value), recent: lists.recent }
}

// 開いている一覧を「満杯」の見た目へ直す。☆ を押せなくして理由を出す (☆ の title)
export function withSavedFull(dd: Dropdown): Dropdown {
  return { ...dd, list: dd.list && { ...dd.list, savedFull: true } }
}

// 登録を切り替えた後の一覧。**行の並びは動かさない** — ★/☆ と 🕐 の
// 切り替えだけを反映する (並べ直すのは次に開いたとき。docs/59 §4)
export function reflectSavedLists(dd: Dropdown, lists: QueryLists): Dropdown {
  return {
    ...dd,
    list: dd.list && { ...dd.list, savedFull: isSavedFull(lists.saved) },
    items: dd.items.map((it) => ({
      kind: lists.saved.includes(it.value) ? 'saved' : 'recent',
      value: it.value,
    })),
  }
}
